// One MVP session: resting reference (Brain Check, provisional) + one training
// exercise. The bridge records the EEG and (live mode only) uploads it and
// indexes the session in Supabase; the browser never talks to Supabase. No DOM here.

export const APP_VERSION = '0.1.0';

function pad(n) { return String(n).padStart(2, '0'); }

export function newSessionId(d = new Date()) {
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `s${stamp}_${Math.random().toString(36).slice(2, 8)}`;
}

export class Session {
  constructor(signal, cfg) {
    this.signal = signal;
    this.cfg = cfg;
    this.id = null;
    this.participant = '';
    this.context = {};
    this.started = false;
    this.finished = false;
    this.events = [];
    this.series = [];
    this.brainCheck = null;
    this.game = null; // { calibration: {...}, startedAt, endedAt }
    this.result = null;
    this.headsetDrops = 0;
    this._lastState = null;
    this._unsub = signal.on('status', (st) => this._noteStatus(st));
  }

  get active() { return this.started && !this.finished; }
  get mode() { return this.signal.mode; }

  async start(participant, context = {}) {
    if (this.started) return;
    this.id = newSessionId();
    this.participant = participant;
    this.context = context;
    this.startedAt = new Date().toISOString();
    this.t0 = performance.now();
    this.reconnects0 = this.signal.src.reconnects || 0;
    await this.signal.request('session.start', {
      session_id: this.id,
      meta: { participant_code: participant, app_version: APP_VERSION, ...context },
    });
    this.started = true;
    this._log('session_start');
  }

  _log(code, extra = {}) {
    this.events.push({ code, t_s: Math.round(performance.now() - (this.t0 || performance.now())) / 1000, utc: new Date().toISOString(), ...extra });
  }

  _noteStatus(st) {
    if (!this.active) return;
    if (this._lastState === 'streaming' && st.state !== 'streaming') {
      this.headsetDrops += 1;
      this._log('headset_drop', { state: st.state, detail: st.detail });
    }
    this._lastState = st.state;
  }

  async mark(code, payload = {}) {
    this._log(code, payload);
    if (!this.active) return null;
    try {
      return await this.signal.request('mark', { code, payload });
    } catch (e) {
      this._log('mark_failed', { mark: code, error: String(e.message || e) });
      return null;
    }
  }

  async analyseBrainCheck() {
    this.brainCheck = await this.signal.request('bc.analyse', {}, 60000);
    return this.brainCheck;
  }

  // 4 Hz during the exercise: what the participant saw, and why.
  sample(t, fb, quality) {
    this.series.push({
      t: Math.round(t * 100) / 100,
      raw: fb.valid ? round4(fb.raw) : null,
      v: round4(fb.value),
      thr: fb.threshold == null ? null : round4(fb.threshold),
      valid: fb.valid,
      q: quality?.measured ? quality.mean : null,
    });
  }

  summary() {
    const train = this.series.filter((s) => s.t >= 0);
    const valid = train.filter((s) => s.valid && s.raw != null && s.thr != null);
    const inTarget = valid.filter((s) => s.raw > s.thr).length;
    const third = Math.max(1, Math.floor(valid.length / 3));
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const qs = train.map((s) => s.q).filter((q) => q != null);
    return {
      exercise: 'space_flight',
      signal: 'relative_alpha_8_12_over_1_30',
      calibration: this.game?.calibration || null,
      training_s: train.length ? train[train.length - 1].t : 0,
      samples: train.length,
      valid_pct: train.length ? round1((100 * valid.length) / train.length) : 0,
      time_in_target_pct: valid.length ? round1((100 * inTarget) / valid.length) : null,
      mean_raw: round4(mean(valid.map((s) => s.raw))),
      mean_raw_first_third: round4(mean(valid.slice(0, third).map((s) => s.raw))),
      mean_raw_last_third: round4(mean(valid.slice(-third).map((s) => s.raw))),
      quality_mean: round1(mean(qs)),
      headset_drops: this.headsetDrops,
      bridge_reconnects: (this.signal.src.reconnects || 0) - (this.reconnects0 || 0),
    };
  }

  // Stops the bridge recording. In live mode the bridge uploads the EEG and indexes
  // the session in Supabase; developer-mode (sim/replay) sessions stay local.
  async finish() {
    if (!this.active) return this.result;
    this._log('session_end');
    const summary = this.summary();
    const row = {
      participant_code: this.participant,
      segment: this.context.segment || null,
      lang: this.context.lang || null,
      exercise: 'space_flight',
      started_at: this.startedAt,
      ended_at: new Date().toISOString(),
      device_id: this.signal.state.status?.device_id || null,
      app_version: APP_VERSION,
      bridge_version: this.signal.state.hello?.version || null,
      restarts: summary.headset_drops + summary.bridge_reconnects,
      brain_check: this.brainCheck,
      summary,
      events: this.events,
      series: this.series,
    };
    let stop = null, stopError = null;
    try {
      stop = await this.signal.request('session.stop', { summary, row }, 240000);
    } catch (e) {
      stopError = String(e.message || e);
    }
    this.finished = true;
    this.result = { row, stop, stopError, saved: stop?.saved || { ok: false, error: stopError } };
    this._unsub?.();
    return this.result;
  }
}

function round4(x) { return x == null || !Number.isFinite(x) ? null : Math.round(x * 10000) / 10000; }
function round1(x) { return x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10; }
