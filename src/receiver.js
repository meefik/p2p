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
 * @param {Object} config.driver - Signaling driver (required). Expected to provide
 *                                 on(path, handler), off(path, handler), and emit(path, message).
 * @param {Array<Object>} [config.iceServers] - ICE servers for RTCPeerConnection.
 * @param {number} [config.timeout=30] - Ping interval in seconds.
 * @param {number} [config.attempts=10] - Number of ping attempts while peers are present.
 *
 * Events emitted (CustomEvent.detail):
 * - 'message' : { id, message, metadata } // data channel message received
 * - 'stream'  : { id, stream, audioEnabled, videoEnabled, metadata } // remote media stream
 * - 'change'  : { id, audioEnabled, videoEnabled } // sender changed media state
 * - 'connect' : { id, peer } // peer connection established
 * - 'open'    : { id, channel } // data channel opened
 * - 'close'   : { id, channel } // data channel closed
 * - 'dispose' : { id, peer } // peer disposed
 * - 'error'   : { id, error } // error occurred
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
      timeout = 30,
      attempts = 10,
    } = config || {};
    if (!driver) {
      throw new Error('Missing driver');
    }
    this.driver = driver;
    this.iceServers = iceServers;
    this.timeout = timeout;
    this.attempts = attempts;
    this.peers = new Map();
    this.channels = new Map();
    this.candidateQueues = new Map();
  }

  start(options) {
    if (this._handler) return;

    const { room } = options || {};

    this.id = uuid();
    this.room = room || 'default';

    this._handler = async (e) => {
      const { type, id, offer, candidate, audioEnabled, videoEnabled, metadata } = e;
      if (!type || !id || this.id === id) return;

      // request connection
      if (type === 'invoke') {
        if (this.peers.has(id)) return;

        try {
          this.driver.emit(['sender', this.room, id], {
            type: 'invoke',
            id: this.id,
          });
        }
        catch (error) {
          this.dispatchEvent(new CustomEvent('error', {
            detail: { id, error },
          }));
        }

        return;
      }

      // set remote description
      if (type === 'offer' && offer) {
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
            this.driver.emit(['sender', this.room, id], {
              type: 'candidate',
              id: this.id,
              candidate: e.candidate,
            });
          });

          peer.addEventListener('datachannel', (e) => {
            if (this.channels.has(id)) return;

            const { channel } = e;
            this.channels.set(id, channel);

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
            channel.addEventListener('message', (e) => {
              const { data: message } = e;
              this.dispatchEvent(new CustomEvent('message', {
                detail: { id, message, metadata },
              }));
            });
          }, { once: true });

          peer.addEventListener('track', (e) => {
            const [stream] = e.streams;
            this.dispatchEvent(new CustomEvent('stream', {
              detail: { id, stream, audioEnabled, videoEnabled, metadata },
            }));
          }, { once: true });

          await peer.setRemoteDescription(new RTCSessionDescription(offer));

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

          await peer.setLocalDescription(await peer.createAnswer());

          // send answer
          this.driver.emit(['sender', this.room, id], {
            type: 'answer',
            id: this.id,
            answer: peer.localDescription,
          });
        }
        catch (error) {
          this.dispatchEvent(new CustomEvent('error', {
            detail: { id, error },
          }));
        }

        return;
      }

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

      // change media state
      if (type === 'change') {
        const peer = this.peers.get(id);
        if (!peer) return;

        this.dispatchEvent(new CustomEvent('change', {
          detail: { id, audioEnabled, videoEnabled },
        }));

        return;
      }

      // end connection
      if (type === 'dispose') {
        this.dispose(id);

        return;
      }
    };

    this.driver.on(['receiver', this.room], this._handler);
    this.driver.on(['receiver', this.room, this.id], this._handler);

    this.driver.emit(['sender', this.room], {
      type: 'invoke',
      id: this.id,
    });

    this._ping = 0;
    this._timer = setInterval(() => {
      if (this.peers.size > 0) {
        this._ping = this.attempts;
      }
      if (this._ping > 0) {
        this._ping--;
        this.driver.emit(['sender', this.room], {
          type: 'invoke',
          id: this.id,
        });
      }
    }, this.timeout * 1000);
  }

  stop() {
    if (!this._handler) return;

    clearInterval(this._timer);
    delete this._timer;

    this.driver.off(['receiver', this.room], this._handler);
    this.driver.off(['receiver', this.room, this.id], this._handler);

    for (const channel of this.channels.values()) {
      channel.close();
    }
    this.channels.clear();

    for (const [id, peer] of this.peers) {
      peer.close();

      this.dispatchEvent(new CustomEvent('dispose', {
        detail: { id, peer },
      }));
    }
    this.peers.clear();

    this.candidateQueues.clear();

    delete this._handler;
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
}
