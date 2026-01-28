import {
  uuid,
  defaultIceServers,
} from './helpers.js';

/**
 * Receiver listens for signaling messages from senders and establishes WebRTC
 * RTCPeerConnection instances for incoming offers. It manages data channels and
 * remote media streams and emits events to notify callers about messages,
 * streams, disposals, and errors.
 *
 * @extends {EventTarget}
 *
 * @fires Receiver#connect Emitted when a peer connection is established.
 * @fires Receiver#stream Emitted when a remote media stream is received.
 * @fires Receiver#dispose Emitted when a peer connection is closed.
 * @fires Receiver#error Emitted when an error occurs.
 * @fires Receiver#channel:open Emitted when a data channel is opened.
 * @fires Receiver#channel:close Emitted when a data channel is closed.
 * @fires Receiver#channel:error Emitted when a data channel error occurs.
 * @fires Receiver#channel:message Emitted when a message is received on a data channel.
 */
export class Receiver extends EventTarget {
  /**
   * Creates an instance of Receiver.
   *
   * @param {Object} config Configuration options.
   * @param {Object} config.driver Signaling driver (required).
   * @param {RTCIceServer[]} [config.iceServers] STUN/TURN servers to use for RTCPeerConnection.
   * @param {number} [config.connectionTimeout=30] Connection timeout in seconds.
   * @param {number} [config.pingInterval=30] Ping interval in seconds to re-establish connections.
   * @param {number} [config.pingAttempts=10] Number of ping attempts after all peers are gone.
   * @throws {Error} If the driver is not provided.
   */
  constructor(config) {
    super();
    const {
      driver,
      iceServers = defaultIceServers,
      connectionTimeout = 30,
      pingInterval = 30,
      pingAttempts = 10,
    } = config || {};
    if (!driver) {
      throw new Error('Missing driver');
    }
    this.driver = driver;
    this.iceServers = iceServers;
    this.connectionTimeout = connectionTimeout;
    this.pingInterval = pingInterval;
    this.pingAttempts = pingAttempts;
    this.connections = new Map();
    this.candidateQueues = new Map();
  }

  /**
   * Indicates whether the Receiver is currently active.
   *
   * @returns {boolean} True if the Receiver is started, false otherwise.
   */
  get active() {
    return !!this._handler;
  }

  /**
   * Start the Receiver and listen for incoming connections.
   *
   * @param {Object} options Options for starting the Receiver.
   * @param {string} [options.room='default'] Room name to join.
   * @param {Object} [options.credentials] Credentials for authentication.
   * @returns {void}
   */
  start(options) {
    if (this._handler) return;

    const { room, credentials } = options || {};

    this.id = uuid();
    this.room = room || 'default';

    this._handler = async (e) => {
      const { type, id, offer, candidate, metadata } = e;
      if (!type || !id || this.id === id) return;

      // request connection
      if (type === 'invoke') {
        if (this.connections.has(id)) return;

        this.driver.emit(['sender', this.room, id], {
          type: 'invoke',
          id: this.id,
          credentials,
        });

        return;
      }

      // set remote description
      if (type === 'offer' && offer) {
        if (this.connections.has(id)) return;

        try {
          const conn = {
            id,
            peer: new RTCPeerConnection({ iceServers: this.iceServers }),
            dispose: (error) => {
              clearTimeout(timeout);
              this.connections.delete(id);

              conn.channels?.forEach(channel => channel?.close());
              conn.peer?.close();

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
                  detail: { id, peer: conn.peer, metadata },
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
            this.driver.emit(['sender', this.room, id], {
              type: 'candidate',
              id: this.id,
              candidate: e.candidate,
            });
          });

          conn.peer.addEventListener('datachannel', (e) => {
            const { channel } = e;
            if (conn.channels.has(channel.label)) return;

            conn.channels.set(channel.label, channel);

            channel.addEventListener('open', () => {
              this.dispatchEvent(new CustomEvent('channel:open', {
                detail: { id, peer: conn.peer, channel },
              }));
            }, { once: true });

            channel.addEventListener('close', () => {
              this.dispatchEvent(new CustomEvent('channel:close', {
                detail: { id, peer: conn.peer, channel },
              }));
            }, { once: true });

            channel.addEventListener('error', (e) => {
              const { error } = e;
              this.dispatchEvent(new CustomEvent('channel:error', {
                detail: { id, peer: conn.peer, channel, error },
              }));
            });

            channel.addEventListener('message', (e) => {
              const { data } = e;
              this.dispatchEvent(new CustomEvent('channel:message', {
                detail: { id, peer: conn.peer, channel, data },
              }));
            });
          });

          conn.peer.addEventListener('track', (e) => {
            conn.stream = e.streams[0];
            this.dispatchEvent(new CustomEvent('stream', {
              detail: { id, peer: conn.peer, stream: conn.stream, metadata },
            }));
          }, { once: true });

          await conn.peer.setRemoteDescription(new RTCSessionDescription(offer));

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

          await conn.peer.setLocalDescription(await conn.peer.createAnswer());

          // send answer
          this.driver.emit(['sender', this.room, id], {
            type: 'answer',
            id: this.id,
            answer: conn.peer.localDescription,
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

      // end connection
      if (type === 'dispose') {
        const conn = this.connections.get(id);
        if (!conn) return;

        conn.dispose();

        return;
      }
    };

    this.driver.on(['receiver', this.room], this._handler);
    this.driver.on(['receiver', this.room, this.id], this._handler);

    this.driver.emit(['sender', this.room], {
      type: 'invoke',
      id: this.id,
      credentials,
    });

    this._ping = 0;
    this._timer = setInterval(() => {
      if (this.connections.size > 0) {
        this._ping = this.pingAttempts;
      }
      if (this._ping > 0) {
        this._ping--;
        this.driver.emit(['sender', this.room], {
          type: 'invoke',
          id: this.id,
          credentials,
        });
      }
    }, this.pingInterval * 1000);
  }

  /**
   * Stop the Receiver and close all connections.
   *
   * @returns {void}
   */
  stop() {
    if (!this._handler) return;

    clearInterval(this._timer);
    delete this._timer;

    this.driver.off(['receiver', this.room], this._handler);
    this.driver.off(['receiver', this.room, this.id], this._handler);

    for (let conn of this.connections.values()) {
      conn.dispose();
    }
    this.connections.clear();

    this.candidateQueues.clear();

    delete this._handler;
  }
}
