// Minimal event emitter shared by the signal sources and the session.
export class Bus {
  constructor() { this._h = new Map(); }
  on(event, fn) {
    if (!this._h.has(event)) this._h.set(event, new Set());
    this._h.get(event).add(fn);
    return () => this._h.get(event)?.delete(fn);
  }
  emit(event, data) {
    for (const fn of this._h.get(event) || []) {
      try { fn(data); } catch (e) { console.error(`[neroes] handler ${event}`, e); }
    }
  }
}
