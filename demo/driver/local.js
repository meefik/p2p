export class LocalDriver extends Map {
  constructor() {
    super();
    this._storageEventHandler = (e) => {
      const { key, newValue } = e;
      const data = JSON.parse(newValue);
      if (this.has(key)) {
        for (const handler of this.get(key)) {
          handler(data);
        }
      }
    };
  }

  open() {
    window.addEventListener('storage', this._storageEventHandler);
  }

  close() {
    window.removeEventListener('storage', this._storageEventHandler);
  }

  on(namespace, handler) {
    const ns = namespace.join(':');
    if (!this.has(ns)) {
      this.set(ns, new Set());
    }
    this.get(ns).add(handler);
  }

  off(namespace, handler) {
    const ns = namespace.join(':');
    if (this.has(ns)) {
      if (handler) {
        this.get(ns).delete(handler);
      }
      else {
        this.get(ns).clear();
      }
      if (!this.get(ns).size) {
        this.delete(ns);
      }
    }
  }

  emit(namespace, data) {
    const ns = namespace.join(':');
    localStorage.setItem(ns, JSON.stringify({ ...data, _: Math.random() }));
  }
}
