import {
  uuid,
  defaultIceServers,
} from './helpers.js';

/**
 * Receiver listens for signaling messages from senders and establishes WebRTC
 * RTCPeerConnection instances for incoming offers. It manages data channels and
 * remote media streams and emits events to notify callers about messages,
 * streams, state changes, disposals, and errors.
 *
 * @extends {EventTarget}
 *
 * @param {Object} config - Configuration options passed to the constructor.
 * @param {Object} config.driver - Signaling driver (required) used to receive and send messages.
 * @param {Array<RTCIceServer>} [config.iceServers] - ICE servers for RTCPeerConnection.
 * @param {number} [config.connectionTimeout=30] - Connection timeout in seconds.
 * @param {number} [config.pingInterval=30] - Ping interval in seconds to re-establish connections.
 * @param {number} [config.pingAttempts=10] - Number of ping attempts after all peers are gone.
 *
 * Events emitted (CustomEvent.detail):
 * - 'message' : { id: string, message: any } // data channel message received
 * - 'stream'  : { id: string, stream: MediaStream } // remote media stream
 * - 'channel' : { id: string, channel: RTCDataChannel } // data channel opened
 * - 'sync'    : { id: string, state: object } // sender changed media state
 * - 'connect' : { id: string, peer: RTCPeerConnection } // peer connection established
 * - 'dispose' : { id: string, error?: Error } // peer disposed
 * - 'error'   : { id: string, error: Error } // non-fatal error occurred
 *
 * Public methods:
 * - start(options) : Begin listening for signaling; options.room can be provided.
 * - stop()         : Stop listening and close all connections.
 */
export class Receiver extends EventTarget {
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

  get active() {
    return !!this._handler;
  }

  start(options) {
    if (this._handler) return;

    const { room, credentials } = options || {};

    this.id = uuid();
    this.room = room || 'default';

    this._handler = async (e) => {
      const { type, id, offer, candidate, state } = e;
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
            state,
            dispose: (error) => {
              clearTimeout(timeout);
              this.connections.delete(id);

              conn.channel?.close();
              conn.peer?.close();

              this.dispatchEvent(new CustomEvent('dispose', {
                detail: { id, peer: conn.peer, error, state: conn.state },
              }));
            },
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
                  detail: { id, peer: conn.peer, state: conn.state },
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
            if (conn.channel) return;
            conn.channel = e.channel;

            conn.channel.addEventListener('open', () => {
              this.dispatchEvent(new CustomEvent('channel', {
                detail: { id, peer: conn.peer, channel: conn.channel, state: conn.state },
              }));
            }, { once: true });

            conn.channel.addEventListener('message', (e) => {
              const { data: message } = e;

              this.dispatchEvent(new CustomEvent('message', {
                detail: { id, peer: conn.peer, message, state: conn.state },
              }));
            });
          }, { once: true });

          conn.peer.addEventListener('track', (e) => {
            if (conn.stream) return;
            conn.stream = e.streams[0];

            this.dispatchEvent(new CustomEvent('stream', {
              detail: { id, peer: conn.peer, stream: conn.stream, state: conn.state },
            }));
          }, { once: true });

          await conn.peer.setRemoteDescription(new RTCSessionDescription(offer));

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
          else this.dispatchEvent(new CustomEvent('error', { detail: { id, error } }));
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

      // sync media state
      if (type === 'sync') {
        const conn = this.connections.get(id);
        if (!conn) return;

        conn.state = state;

        this.dispatchEvent(new CustomEvent('sync', {
          detail: { id, peer: conn.peer, state: conn.state },
        }));

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

  stop() {
    if (!this._handler) return;

    clearInterval(this._timer);
    delete this._timer;

    this.driver.off(['receiver', this.room], this._handler);
    this.driver.off(['receiver', this.room, this.id], this._handler);

    for (const conn of this.connections.values()) {
      conn.dispose();
    }
    this.connections.clear();

    this.candidateQueues.clear();

    delete this._handler;
  }
}
