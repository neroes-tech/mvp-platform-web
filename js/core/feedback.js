// Neurofeedback mapping: raw relative alpha (0–1) → game value (0–1).
//
// Mirrors the Unity game's logic in a simplified form (calibration, then a fixed
// threshold at a percentile of the calibration values, game value from the
// distance to that threshold). Unity: CalibrationHandler.cs, BaselineCalculator.cs,
// WavePowerHandler.DifferenceFromBaseline.
export class Feedback {
  constructor({ percentile = 0.5, gain = 1.4, smoothing = 0.25 } = {}) {
    this.percentile = percentile;
    this.gain = gain;
    this.smoothing = smoothing;
    this.reset();
  }

  reset() {
    this.calib = [];
    this.calibrating = false;
    this.threshold = null;
    this.spread = null;
    this.value = 0.5;
    this.raw = null;
    this.valid = false;
    this.inTarget = false;
  }

  startCalibration() { this.reset(); this.calibrating = true; }

  // Ends calibration. Returns false when there were too few valid values.
  endCalibration() {
    this.calibrating = false;
    const xs = this.calib.slice().sort((a, b) => a - b);
    if (xs.length < 8) return false;
    this.threshold = quantile(xs, this.percentile);
    const dev = xs.map((x) => Math.abs(x - quantile(xs, 0.5))).sort((a, b) => a - b);
    this.spread = Math.max(1.4826 * quantile(dev, 0.5), 0.01);
    return true;
  }

  push(raw, valid) {
    this.valid = Boolean(valid) && Number.isFinite(raw);
    if (!this.valid) return;
    this.raw = raw;
    if (this.calibrating) { this.calib.push(raw); return; }
    if (this.threshold == null) return;
    const z = (raw - this.threshold) / this.spread;
    const target = 1 / (1 + Math.exp(-this.gain * z));
    this.value += (target - this.value) * this.smoothing;
    this.inTarget = raw > this.threshold;
  }
}

export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
