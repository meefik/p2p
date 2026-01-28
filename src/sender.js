import {
  uuid,
  defaultIceServers,
  setPeerConnectionBitrate,
} from './helpers.js';

/**
 * Manages outgoing WebRTC RTCPeerConnections and optional RTCDataChannels to
 * one or more receivers. Responsible for creating offers, attaching local
 * media tracks, exchanging ICE candidates via the signaling driver, and
 * emitting lifecycle and channel events.
 *
 * @extends {EventTarget}
 *
 * @fires Sender#connect Emitted when a peer connection is established.
 * @fires Sender#dispose Emitted when a peer connection is closed.
 * @fires Sender#error Emitted when an error occurs.
 * @fires Sender#channel:open Emitted when a data channel is opened.
 * @fires Sender#channel:close Emitted when a data channel is closed.
 * @fires Sender#channel:error Emitted when a data channel error occurs.
 * @fires Sender#channel:message Emitted when a message is received on a data channel.
 */
export class Sender extends EventTarget {
  /**
   * Creates an instance of Sender.
   *
   * @param {Object} config Configuration options.
   * @param {Object} config.driver Signaling driver (required).
   * @param {RTCIceServer[]} [config.iceServers] STUN/TURN servers to use for RTCPeerConnection.
   * @param {Function} [config.verify] Optional async function to verify incoming connection requests.
   * @param {number} [config.connectionTimeout=30] Connection timeout in seconds.
   * @param {number} [config.audioBitrate] Target audio bitrate in kbps.
   * @param {number} [config.videoBitrate] Target video bitrate in kbps.
   * @throws {Error} If the driver is not provided.
   */
  constructor(config) {
    super();
    const {
      driver,
      iceServers = defaultIceServers,
      verify,
      connectionTimeout = 30,
      audioBitrate,
      videoBitrate,
    } = config || {};
    if (!driver) {
      throw new Error('Missing driver');
    }
    this.driver = driver;
    this.iceServers = iceServers;
    this.verify = verify;
    this.connectionTimeout = connectionTimeout;
    this.audioBitrate = audioBitrate;
    this.videoBitrate = videoBitrate;
    this.connections = new Map();
    this.candidateQueues = new Map();
  }

  /**
   * Indicates whether the Sender is currently active.
   *
   * @returns {boolean} True if the Sender is started, false otherwise.
   * @readonly
   */
  get active() {
    return !!this._handler;
  }

  /**
   * Start the Sender to listen for incoming connection requests.
   *
   * @param {SenderStartOptions} options Options for starting the Sender.
   * @param {string} [options.room='default'] Room name to join.
   * @param {MediaStream} [options.stream] MediaStream to send to receivers.
   * @param {any} [options.metadata] Metadata to share with receivers.
   * @param {object} [options.channels] Data channel labels and options to create per-peer data channels.
   * @returns {void}
   */
  start(options) {
    if (this._handler) return;

    const {
      room,
      stream,
      metadata,
      channels,
    } = options || {};

    this.id = stream?.id || uuid();
    this.room = room || 'default';

    this._handler = async (e) => {
      const { type, id, candidate, answer, credentials } = e;
      if (!type || !id || id === this.id) return;

      // create new peer connection
      if (type === 'invoke') {
        if (this.connections.has(id)) return;

        if (this.verify) {
          const isValid = await this.verify(id, credentials);
          if (!isValid) return;
        }

        try {
          const conn = {
            id,
            peer: new RTCPeerConnection({ iceServers: this.iceServers }),
            dispose: (error) => {
              clearTimeout(timeout);
              this.connections.delete(id);

              conn.channels?.forEach(channel => channel?.close());
              conn.peer?.close();

              this.driver.emit(['receiver', this.room, id], {
                type: 'dispose',
                id: this.id,
              });

              this.dispatchEvent(new CustomEvent('dispose', {
                detail: { id, peer: conn.peer, error },
              }));
            },
            channels: new Map(),
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
          }

          if (channels) {
            for (let channelLabel in channels) {
              if (conn.channels.has(channelLabel)) continue;

              let options = channels[channelLabel];
              if (!options) continue;
              if (typeof options !== 'object') options = {};

              const dataChannel = conn.peer.createDataChannel(channelLabel, options);
              conn.channels.set(channelLabel, dataChannel);

              dataChannel.addEventListener('open', () => {
                this.dispatchEvent(new CustomEvent('channel:open', {
                  detail: { id, peer: conn.peer, channel: dataChannel },
                }));
              }, { once: true });

              dataChannel.addEventListener('close', () => {
                this.dispatchEvent(new CustomEvent('channel:close', {
                  detail: { id, peer: conn.peer, channel: dataChannel },
                }));
              }, { once: true });

              dataChannel.addEventListener('error', (e) => {
                const { error } = e;
                this.dispatchEvent(new CustomEvent('channel:error', {
                  detail: { id, peer: conn.peer, channel: dataChannel, error },
                }));
              });

              dataChannel.addEventListener('message', (e) => {
                const { data } = e;
                this.dispatchEvent(new CustomEvent('channel:message', {
                  detail: { id, peer: conn.peer, channel: dataChannel, data },
                }));
              });
            }
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
            metadata,
          });
        }
        catch (error) {
          const conn = this.connections.get(id);
          if (conn) conn.dispose(error);
          else this.dispatchEvent(new CustomEvent('error', {
            detail: { id, error },
          }));
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
          for (let candidate of this.candidateQueues.get(id)) {
            try {
              await conn.peer.addIceCandidate(new RTCIceCandidate(candidate));
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

  /**
   * Stop the Sender and close all connections and data channels.
   *
   * @returns {void}
   */
  stop() {
    if (!this._handler) return;

    this.driver.off(['sender', this.room], this._handler);
    this.driver.off(['sender', this.room, this.id], this._handler);

    for (let conn of this.connections.values()) {
      conn.dispose();
    }

    this.connections.clear();
    this.candidateQueues.clear();

    delete this._handler;
  }
}
