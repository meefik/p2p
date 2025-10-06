import { connect, StringCodec } from 'https://esm.sh/nats.ws';

const sc = StringCodec();

const createEncryptionKey = async (secret) => {
  const secretHash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(secret),
  );
  return await crypto.subtle.importKey(
    'raw',
    secretHash,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
};

const encrypt = async (payload, cryptoKey) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, payload),
  );
  const data = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  data.set(iv, 0);
  data.set(ciphertext, iv.byteLength);
  return data;
};

const decrypt = async (data, cryptoKey) => {
  const iv = data.slice(0, 12);
  const ct = data.slice(12);
  const payload = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ct);
  return payload;
};

export class NatsDriver {
  constructor({ servers, secret } = {}) {
    this.servers = servers || ['wss://demo.nats.io:8443'];
    this._secret = secret;
    this._handlers = new Map();
  }

  async open() {
    this.nc = await connect({ servers: this.servers, noEcho: true });
    if (this._secret) {
      this._cryptoKey = await createEncryptionKey(this._secret);
    }
  }

  async close() {
    await this.nc.drain();
  }

  on(namespace, handler) {
    const ns = [].concat(namespace).join('.');
    const sub = this.nc.subscribe(ns, {
      callback: async (err, msg) => {
        if (err) {
          console.error(err);
          return;
        }
        let data = msg.data;
        if (this._cryptoKey) {
          data = await decrypt(data, this._cryptoKey);
        }
        const payload = JSON.parse(sc.decode(data));
        handler(payload);
      },
    });
    if (!this._handlers.has(ns)) {
      this._handlers.set(ns, new Map());
    }
    this._handlers.get(ns).set(handler, sub);
  }

  off(namespace, handler) {
    const ns = [].concat(namespace).join('.');
    const sub = this._handlers.get(ns)?.get(handler);
    if (sub) {
      sub.unsubscribe();
      this._handlers.get(ns).delete(handler);
    }
    if (this._handlers.get(ns)?.size === 0) {
      this._handlers.delete(ns);
    }
  }

  async emit(namespace, message) {
    const ns = [].concat(namespace).join('.');
    if (this.nc) {
      let data = sc.encode(JSON.stringify(message));
      if (this._cryptoKey) {
        data = await encrypt(data, this._cryptoKey);
      }
      this.nc.publish(ns, data);
    }
  }
}
