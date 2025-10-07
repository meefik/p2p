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

export class NatsDriver extends Map {
  constructor({ servers } = {}) {
    super();
    this.servers = servers || ['wss://demo.nats.io:8443'];
  }

  async open(secret) {
    this.nc = await connect({ servers: this.servers, noEcho: true });
    if (secret) {
      this.cryptoKey = await createEncryptionKey(secret);
    }
  }

  async close() {
    await this.nc.drain();
  }

  on(namespace, handler) {
    const ns = namespace.join(':');
    const sub = this.nc.subscribe(ns, {
      callback: async (err, msg) => {
        if (err) {
          console.error(err);
          return;
        }
        let data = msg.data;
        if (this.cryptoKey) {
          data = await decrypt(data, this.cryptoKey);
        }
        const payload = JSON.parse(sc.decode(data));
        handler(payload);
      },
    });
    if (!this.has(ns)) {
      this.set(ns, new Map());
    }
    this.get(ns).set(handler, sub);
  }

  off(namespace, handler) {
    const ns = namespace.join(':');
    const sub = this.get(ns)?.get(handler);
    if (sub) {
      sub.unsubscribe();
      this.get(ns).delete(handler);
    }
    if (!this.get(ns)?.size) {
      this.delete(ns);
    }
  }

  async emit(namespace, message) {
    const ns = namespace.join(':');
    if (this.nc) {
      let data = sc.encode(JSON.stringify(message));
      if (this.cryptoKey) {
        data = await encrypt(data, this.cryptoKey);
      }
      this.nc.publish(ns, data);
    }
  }
}
