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
 * @param {Object} config.driver - Signaling driver (required) used to receive and send messages.
 * @param {Array<RTCIceServer>} [config.iceServers] - STUN/TURN servers to use for RTCPeerConnection.
 * @param {number} [config.connectionTimeout=30] - Connection timeout in seconds.
 * @param {number} [config.queueSize=10] - Maximum number of messages to queue if no channels are connected.
 * @param {number} [config.audioBitrate] - Target audio bitrate in kbps.
 * @param {number} [config.videoBitrate] - Target video bitrate in kbps.
 * @param {Array<string>} [config.audioCodecs] - Preferred audio codecs.
 * @param {Array<string>} [config.videoCodecs] - Preferred video codecs.
 *
 * Events emitted (CustomEvent.detail):
 * - 'connect' : { id: string, peer: RTCPeerConnection } // peer connection established
 * - 'dispose' : { id: string, error?: Error } // peer disposed
 * - 'error'   : { id: string, error: Error } // non-fatal error occurred
 *
 * Public methods:
 * - start(options)     : Begin listening for signaling; options.room can be provided.
 * - stop()             : Stop listening and close all connections.
 * - send(data, id)     : Send data via data channel (all connected peers or specific peer).
 * - sync(state, merge) : Update sender state and notify all connected peers.
 */
export class Sender extends EventTarget {
  constructor(config) {
    super();
    const {
      driver,
      iceServers = defaultIceServers,
      connectionTimeout = 30,
      queueSize = 10,
      audioBitrate,
      videoBitrate,
      audioCodecs,
      videoCodecs,
    } = config || {};
    if (!driver) {
      throw new Error('Missing driver');
    }
    this.driver = driver;
    this.iceServers = iceServers;
    this.connectionTimeout = connectionTimeout;
    this.queueSize = queueSize;
    this.audioBitrate = audioBitrate;
    this.videoBitrate = videoBitrate;
    this.audioCodecs = audioCodecs;
    this.videoCodecs = videoCodecs;
    this.connections = new Map();
    this.candidateQueues = new Map();
  }

  get active() {
    return !!this._handler;
  }

  start(options) {
    if (this._handler) return;

    const {
      stream,
      room,
      state,
      dataChannel,
    } = options || {};

    this.id = stream?.id || uuid();
    this.room = room || 'default';
    this.state = state || {};

    this._handler = async (e) => {
      const { type, id, candidate, answer } = e;
      if (!type || !id || id === this.id) return;

      // create new peer connection
      if (type === 'invoke') {
        if (this.connections.has(id)) return;

        try {
          const conn = {
            id,
            peer: new RTCPeerConnection({ iceServers: this.iceServers }),
            dispose: (error) => {
              clearTimeout(timeout);
              this.connections.delete(id);

              conn.channel?.close();
              conn.peer?.close();

              this.driver.emit(['receiver', this.room, id], {
                type: 'dispose',
                id: this.id,
                state: this.state,
              });

              this.dispatchEvent(new CustomEvent('dispose', {
                detail: { id, peer: conn.peer, error },
              }));
            },
            queue: [],
          };
          this.connections.set(id, conn);

          const timeout = this.connectionTimeout > 0 && setTimeout(
            () => conn.dispose(new Error('Connection timeout')),
            this.connectionTimeout * 1000,
          );

          conn.peer.addEventListener('iceconnectionstatechange', (e) => {
            const { iceConnectionState } = e.target;
            switch (iceConnectionState) {
              case 'connected':
                clearTimeout(timeout);
                this.dispatchEvent(new CustomEvent('connect', {
                  detail: { id, peer: conn.peer },
                }));
                break;
              case 'disconnected':
                conn.dispose();
                break;
              case 'failed':
                conn.dispose(new Error('ICE connection failed'));
                break;
            }
          });

          conn.peer.addEventListener('icecandidate', (e) => {
            if (!e?.candidate) return;
            this.driver.emit(['receiver', this.room, id], {
              type: 'candidate',
              id: this.id,
              candidate: e.candidate,
            });
          });

          if (stream) {
            stream.getTracks().forEach(track => conn.peer.addTrack(track, stream));
            setPeerConnectionBitrate(conn.peer, this.audioBitrate, this.videoBitrate);
            setPreferredCodecs(conn.peer, this.videoCodecs, 'video');
            setPreferredCodecs(conn.peer, this.audioCodecs, 'audio');
          }
          if (!stream || dataChannel) {
            conn.channel = conn.peer.createDataChannel(id);
            conn.channel.addEventListener('open', () => {
              // flush queued messages
              while (conn.queue.length) {
                const data = conn.queue.shift();
                conn.channel.send(data);
              }
            }, { once: true });
          }

          const offer = await conn.peer.createOffer({
            offerToReceiveAudio: stream ? stream.getAudioTracks().length > 0 : false,
            offerToReceiveVideo: stream ? stream.getVideoTracks().length > 0 : false,
            iceRestart: false,
          });

          await conn.peer.setLocalDescription(offer);

          // send offer
          this.driver.emit(['receiver', this.room, id], {
            type: 'offer',
            id: this.id,
            offer,
            state: this.state,
          });
        }
        catch (error) {
          const conn = this.connections.get(id);
          if (conn) conn.dispose(error);
          else this.dispatchEvent(new CustomEvent('error', { detail: { id, error } }));
        }

        return;
      }

      // set remote description
      if (type === 'answer' && answer) {
        const conn = this.connections.get(id);
        if (!conn) return;

        try {
          await conn.peer.setRemoteDescription(new RTCSessionDescription(answer));
        }
        catch (error) {
          conn.dispose(error);
          return;
        }

        // add queued candidates
        if (this.candidateQueues.has(id)) {
          for (const candidate of this.candidateQueues.get(id)) {
            try {
              await conn.peer.addIceCandidate(new RTCIceCandidate(candidate));
            }
            catch (error) {
              this.dispatchEvent(new CustomEvent('error', { detail: { id, error } }));
            }
          }
          this.candidateQueues.delete(id);
        }

        return;
      }

      // add ice candidate
      if (type === 'candidate' && candidate) {
        const conn = this.connections.get(id);

        if (!conn) {
          if (!this.candidateQueues.has(id)) this.candidateQueues.set(id, []);
          this.candidateQueues.get(id).push(candidate);
          return;
        }

        try {
          await conn.peer.addIceCandidate(new RTCIceCandidate(candidate));
        }
        catch (error) {
          this.dispatchEvent(new CustomEvent('error', { detail: { id, error } }));
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

    for (const conn of this.connections.values()) {
      conn.dispose();
    }

    this.connections.clear();
    this.candidateQueues.clear();

    delete this._handler;
  }

  send(data, id) {
    const send = (conn, data) => {
      if (conn.channel?.readyState === 'open') {
        conn.channel.send(data);
      }
      else {
        conn.queue.push(data);
        if (conn.queue.length > this.queueSize) {
          conn.queue.shift();
        }
      }
    };

    if (id) {
      const conn = this.connections.get(id);
      if (conn) send(conn, data);
    }
    else {
      for (const conn of this.connections.values()) {
        send(conn, data);
      }
    }
  }

  sync(state, merge) {
    if (merge) {
      Object.assign(this.state, state);
    }

    for (const id of this.connections.keys()) {
      this.driver.emit(['receiver', this.room, id], {
        type: 'sync',
        id: this.id,
        state: this.state,
      });
    }
  }
}
