// The live signal: the local bridge with the headset is the ONLY source.
// There is no browser simulation. Without the bridge the UI shows "no connection"
// and no values; it keeps retrying and comes alive as soon as the bridge answers.
// Keeps the latest state + the neurofeedback mapping. No DOM here.
import { BridgeClient } from './bridge-client.js';
import { Feedback } from './feedback.js';

export function defaultBridgeUrl() {
  const served = location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname);
  return served ? `ws://${location.host}/ws` : 'ws://127.0.0.1:8765/ws';
}

export async function createSignal(cfg = {}) {
  const params = new URLSearchParams(location.search);
  const url = params.get('bridge') || cfg.bridgeUrl || defaultBridgeUrl();
  const src = new BridgeClient(url);

  // `warning`: unicornbench's action, latched. In its ladder `avisar` and `insistir`
  // are one-tick events (session.Escalator); between them the directive is back to
  // `continuar` while `cause` and `message` stay set for as long as the problem lasts.
  // So the warning stays on screen while the same cause persists, and clears when
  // the module reports recovery (no cause). Silenced warnings never latch.
  const state = { hello: null, status: null, quality: null, features: null, lastFeaturesAt: 0, warning: null };
  const feedback = new Feedback(cfg.feedback);
  src.on('hello', (m) => { state.hello = m; });
  src.on('down', () => { state.status = null; state.quality = null; state.features = null; state.warning = null; feedback.valid = false; });
  src.on('status', (m) => { state.status = m; });
  src.on('quality', (m) => {
    state.quality = m;
    const a = m.action || {};
    const w = state.warning;
    if (a.should_act) state.warning = { ...a, since: w && w.cause === a.cause ? w.since : Date.now() };
    else if (!a.cause || a.silenced || (w && a.cause !== w.cause)) state.warning = null;
    else if (w) state.warning = { ...w, seconds: a.seconds, message: a.message || w.message, channels: a.channels };
  });
  src.on('features', (m) => {
    state.features = m;
    state.lastFeaturesAt = performance.now();
    feedback.push(m.nfb?.value, m.nfb?.valid);
  });
  await src.connect(cfg.bridgeTimeoutMs || 2500); // keeps retrying in the background either way

  return {
    src, state, feedback, url,
    // live = headset. sim/replay exist only in the bridge's developer mode (automated tests).
    // offline = no bridge: nothing is shown as data.
    get mode() { return src.connected ? (state.hello?.mode || 'live') : 'offline'; },
    get connected() { return src.connected; },
    get isLive() { return this.mode === 'live'; },
    request: (type, payload, ms) => src.request(type, payload, ms),
    on: (event, fn) => src.on(event, fn),
  };
}
