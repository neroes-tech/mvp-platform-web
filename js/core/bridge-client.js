// WebSocket client for the local bridge (bridge/neroes_bridge/server.py).
// Messages in: hello · status · quality · features · ack. Commands out: see request().
import { Bus } from './bus.js';

export class BridgeClient extends Bus {
  constructor(url) {
    super();
    this.url = url;
    this.kind = 'bridge';
    this.ws = null;
    this.seq = 0;
    this.pending = new Map();
    this.connected = false;
    this.everConnected = false;
    this.reconnects = 0;
    this.hello = null;
    this._retryMs = 1000;
    this._stopped = false;
  }

  // Resolves true once the bridge said hello, false if it did not answer in time.
  connect(timeoutMs = 2000) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
      const off = this.on('hello', () => { off(); finish(true); });
      setTimeout(() => { off(); finish(this.connected); }, timeoutMs);
      this._open();
    });
  }

  _open() {
    if (this._stopped) return;
    let ws;
    try { ws = new WebSocket(this.url); } catch (e) { this._scheduleRetry(); return; }
    this.ws = ws;
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'ack') {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error || 'erro da bridge'));
        }
        return;
      }
      if (msg.type === 'hello') {
        if (this.everConnected) this.reconnects += 1;
        this.connected = true;
        this.everConnected = true;
        this.hello = msg;
        this._retryMs = 1000;
        this.emit('up', msg);
      }
      this.emit(msg.type, msg);
    };
    ws.onclose = () => {
      const was = this.connected;
      this.connected = false;
      for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('ligação à bridge perdida')); }
      this.pending.clear();
      if (was) this.emit('down', {});
      this._scheduleRetry();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  _scheduleRetry() {
    if (this._stopped) return;
    setTimeout(() => this._open(), this._retryMs);
    this._retryMs = Math.min(this._retryMs * 1.6, 5000);
  }

  request(type, payload = {}, timeoutMs = 20000) {
    if (!this.connected) return Promise.reject(new Error('bridge desligada'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`sem resposta da bridge (${type})`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ type, id, ...payload }));
    });
  }

  stop() { this._stopped = true; this.ws?.close(); }
}
