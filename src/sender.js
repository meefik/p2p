import {
  uuid,
  defaultIceServers,
  setPeerConnectionBitrate,
  setPreferredCodecs,
} from './helpers.js';

/**
 * Sender manages outgoing WebRTC PeerConnections and optional data channels
 * to one or more receivers. It handles creating offers, applying local media
 * tracks, exchanging ICE candidates through the provided signaling driver,
 * and exposing simple controls for enabling/disabling audio/video and
 * sending data over opened data channels.
 *
 * @class Sender
 * @extends {EventTarget}
 *
 * @param {Object} config - Configuration object.
 * @param {Object} config.driver - Signaling driver (required) used to emit/on messages.
 * @param {Array<Object>} [config.iceServers] - STUN/TURN servers to use for RTCPeerConnection.
 * @param {number} [config.audioBitrate=16] - Target audio bitrate in kbps.
 * @param {number} [config.videoBitrate=64] - Target video bitrate in kbps.
 * @param {Array<string>} [config.audioCodecs=["audio/opus"]] - Preferred audio codecs.
 * @param {Array<string>} [config.videoCodecs=["video/VP8", "video/VP9"]] - Preferred video codecs.
 *
 * Events emitted (CustomEvent.detail):
 * - 'connect' : { id, peer } // peer connection established
 * - 'open' : { id, channel } // data channel opened
 * - 'close' : { id, channel } // data channel closed
 * - 'dispose' : { id, peer } // peer disposed
 * - 'error'   : { id, error } // error occurred
 *
 * Public methods:
 * - start(options) : Begin listening for signaling; options.room can be provided.
 * - stop()         : Stop listening and close all connections.
 * - send(data)     : Send data to all connected peers via data channels.
 *
 * Public properties:
 * - audioEnabled : Boolean - Enable/disable audio tracks.
 * - videoEnabled : Boolean - Enable/disable video tracks.
 */
export class Sender extends EventTarget {
  constructor(config) {
    super();
    const {
      driver,
      iceServers = defaultIceServers,
      audioBitrate = 16,
      videoBitrate = 64,
      audioCodecs = ['audio/opus'],
      videoCodecs = ['video/VP8', 'video/VP9'],
    } = config || {};
    if (!driver) {
      throw new Error('Missing driver');
    }
    this.driver = driver;
    this.iceServers = iceServers;
    this.audioBitrate = audioBitrate;
    this.videoBitrate = videoBitrate;
    this.audioCodecs = audioCodecs;
    this.videoCodecs = videoCodecs;
    this.peers = new Map();
    this.channels = new Map();
    this.candidateQueues = new Map();
  }

  start(options) {
    if (this._handler) return;

    const {
      stream,
      room,
      metadata,
      dataChannel,
      audioEnabled,
      videoEnabled,
    } = options || {};

    this.id = stream?.id || uuid();
    this.stream = stream;
    this.room = room || 'default';
    this.metadata = metadata;

    if (stream) {
      if (typeof audioEnabled === 'boolean') {
        stream.getAudioTracks().forEach((t) => {
          t.enabled = !!audioEnabled;
        });
      }
      if (typeof videoEnabled === 'boolean') {
        stream.getVideoTracks().forEach((t) => {
          t.enabled = !!videoEnabled;
        });
      }
    }

    this._handler = async (e) => {
      const { type, id, candidate, answer } = e;
      if (!type || !id || id === this.id) return;

      // add ice candidate
      if (type === 'candidate' && candidate) {
        const peer = this.peers.get(id);

        if (!peer) {
          if (!this.candidateQueues.has(id)) this.candidateQueues.set(id, []);
          this.candidateQueues.get(id).push(candidate);
          return;
        }

        try {
          await peer.addIceCandidate(new RTCIceCandidate(candidate));
        }
        catch (error) {
          this.dispatchEvent(new CustomEvent('error', {
            detail: { id, error },
          }));
        }

        return;
      }

      // set remote description
      if (type === 'answer' && answer) {
        const peer = this.peers.get(id);
        if (!peer) return;

        try {
          await peer.setRemoteDescription(new RTCSessionDescription(answer));
        }
        catch (err) {
          return this.dispose(id, err);
        }

        // add queued candidates
        if (this.candidateQueues.has(id)) {
          for (const candidate of this.candidateQueues.get(id)) {
            try {
              await peer.addIceCandidate(new RTCIceCandidate(candidate));
            }
            catch (error) {
              this.dispatchEvent(new CustomEvent('error', {
                detail: { id, error },
              }));
            }
          }
          this.candidateQueues.delete(id);
        }

        return;
      }

      // create new peer
      if (type === 'invoke') {
        if (this.peers.has(id)) return;

        try {
          const peer = new RTCPeerConnection({
            iceServers: this.iceServers,
          });
          this.peers.set(id, peer);

          peer.addEventListener('iceconnectionstatechange', (e) => {
            const { iceConnectionState } = e.target;
            switch (iceConnectionState) {
              case 'connected': {
                this.dispatchEvent(new CustomEvent('connect', {
                  detail: { id, peer },
                }));
                break;
              }
              case 'disconnected': {
                const err = new Error('ICE connection state is disconnected');
                this.dispose(id, err);
                break;
              }
              case 'failed': {
                const err = new Error('ICE connection state is failed');
                this.dispose(id, err);
                break;
              }
            }
          });

          peer.addEventListener('icecandidate', (e) => {
            if (!e?.candidate) return;
            this.driver.emit(['receiver', this.room, id], {
              type: 'candidate',
              id: this.id,
              candidate: e.candidate,
            });
          });

          if (stream) {
            stream.getTracks().forEach(track => peer.addTrack(track, stream));
            setPeerConnectionBitrate(peer, this.audioBitrate, this.videoBitrate);
            setPreferredCodecs(peer, this.videoCodecs, 'video');
            setPreferredCodecs(peer, this.audioCodecs, 'audio');
          }
          if (!stream || dataChannel) {
            const channel = peer.createDataChannel(id);
            channel.addEventListener('open', () => {
              this.dispatchEvent(new CustomEvent('open', {
                detail: { id, channel },
              }));
            }, { once: true });
            channel.addEventListener('close', () => {
              this.dispatchEvent(new CustomEvent('close', {
                detail: { id, channel },
              }));
            }, { once: true });
            this.channels.set(id, channel);
          }

          const offer = await peer.createOffer({
            offerToReceiveAudio: stream ? stream.getAudioTracks().length > 0 : false,
            offerToReceiveVideo: stream ? stream.getVideoTracks().length > 0 : false,
            iceRestart: false,
          });

          await peer.setLocalDescription(offer);

          // send offer
          this.driver.emit(['receiver', this.room, id], {
            type: 'offer',
            id: this.id,
            offer,
            metadata: this.metadata,
            audioEnabled: this.audioEnabled,
            videoEnabled: this.videoEnabled,
          });
        }
        catch (error) {
          this.dispatchEvent(new CustomEvent('error', {
            detail: { id, error },
          }));
        }

        return;
      }
    };

    this.driver.on(['sender', this.room], this._handler);
    this.driver.on(['sender', this.room, this.id], this._handler);

    this.driver.emit(['receiver', this.room], {
      type: 'invoke',
      id: this.id,
    });
  }

  stop() {
    if (!this._handler) return;

    this.driver.off(['sender', this.room], this._handler);
    this.driver.off(['sender', this.room, this.id], this._handler);

    for (const channel of this.channels.values()) {
      channel.close();
    }
    this.channels.clear();

    for (const [id, peer] of this.peers) {
      peer.close();

      this.driver.emit(['receiver', this.room, id], {
        type: 'dispose',
        id: this.id,
      });

      this.dispatchEvent(new CustomEvent('dispose', {
        detail: { id, peer },
      }));
    }
    this.peers.clear();

    this.candidateQueues.clear();

    delete this._handler;
  }

  send(data) {
    for (const channel of this.channels.values()) {
      if (channel.readyState === 'open') {
        channel.send(data);
      }
    }
  }

  dispose(id, error) {
    const channel = this.channels.get(id);
    if (channel) {
      channel.close();
      this.channels.delete(id);
    }

    const peer = this.peers.get(id);
    if (peer) {
      peer.close();
      this.peers.delete(id);

      this.driver.emit(['receiver', this.room, id], {
        type: 'dispose',
        id: this.id,
      });

      this.dispatchEvent(new CustomEvent('dispose', {
        detail: { id, peer },
      }));
    }

    if (error) {
      this.dispatchEvent(new CustomEvent('error', {
        detail: { id, error },
      }));
    }
  }

  get audioEnabled() {
    return this.stream
      ? this.stream.getAudioTracks().some(t => t.enabled)
      : false;
  }

  get videoEnabled() {
    return this.stream
      ? this.stream.getVideoTracks().some(t => t.enabled)
      : false;
  }

  set audioEnabled(enabled) {
    if (!this.stream || this.audioEnabled === !!enabled) return;

    this.stream?.getAudioTracks().forEach((t) => {
      t.enabled = !!enabled;
    });

    this.driver.emit(['receiver', this.room], {
      type: 'change',
      id: this.id,
      audioEnabled: !!enabled,
    });
  }

  set videoEnabled(enabled) {
    if (!this.stream || this.videoEnabled === !!enabled) return;

    this.stream?.getVideoTracks().forEach((t) => {
      t.enabled = !!enabled;
    });

    this.driver.emit(['receiver', this.room], {
      type: 'change',
      id: this.id,
      videoEnabled: !!enabled,
    });
  }
}
