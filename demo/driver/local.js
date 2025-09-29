export class LocalDriver {
  open() {
    this._handlers = {};
    this._storageHandler = (e) => {
      const { key, newValue } = e;
      const data = JSON.parse(newValue);
      if (this._handlers[key]) {
        for (const handler of this._handlers[key]) {
          handler(data);
        }
      }
    };
    window.addEventListener('storage', this._storageHandler);
  }

  close() {
    this._handlers = {};
    window.removeEventListener('storage', this._storageHandler);
  }

  on(namespace, handler) {
    if (!namespace || !handler) return;
    const ns = [].concat(namespace).join('.');
    if (!this._handlers[ns]) {
      this._handlers[ns] = new Set();
    }
    this._handlers[ns].add(handler);
  }

  off(namespace, handler) {
    if (!namespace) return;
    const ns = [].concat(namespace).join('.');
    if (this._handlers[ns]) {
      if (handler) {
        this._handlers[ns].delete(handler);
      }
      else {
        this._handlers[ns].clear();
      }
      if (!this._handlers[ns].size) {
        delete this._handlers[ns];
      }
    }
  }

  emit(namespace, data) {
    if (!namespace || !data) return;
    const ns = [].concat(namespace).join('.');
    localStorage.setItem(ns, JSON.stringify({ ...data, _: Math.random() }));
  }
}
