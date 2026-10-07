// Space flight — the prototype's neuralFlight (index.html L194) with the same
// drawing, driven by the live neurofeedback value instead of Math.sin(t).
// The ship climbs when the value is above the calibrated threshold and sinks
// below it; stars accelerate with it. While calibrating the ship holds the centre.
//
// opts.read() → { value: 0–1, valid: bool, calibrating: bool, label: string }

export function startSpaceFlight(canvas, opts) {
  const x = canvas.getContext('2d');
  let w, h, t = 0, y = null, alive = true;
  const stars = Array.from({ length: 420 }, () => ({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: Math.random(), s: 0.4 + Math.random() * 1.8 }));

  function rz() {
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
    x.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    w = innerWidth; h = innerHeight;
  }
  rz();
  window.onresize = rz;

  function ship(cx, cy, f) {
    x.save(); x.translate(cx, cy); x.shadowBlur = 28; x.shadowColor = '#52f8ff';
    const grd = x.createLinearGradient(0, -35, 0, 38);
    grd.addColorStop(0, '#f6ffff'); grd.addColorStop(0.55, '#8fe9ef'); grd.addColorStop(1, '#176b91');
    x.fillStyle = grd; x.beginPath();
    x.moveTo(0, -38); x.lineTo(34, 24); x.lineTo(11, 17); x.lineTo(0, 38); x.lineTo(-11, 17); x.lineTo(-34, 24);
    x.closePath(); x.fill();
    x.fillStyle = '#47f5e4'; x.beginPath(); x.moveTo(-9, 27); x.lineTo(0, 78 + f * 28); x.lineTo(9, 27); x.closePath(); x.fill();
    x.restore();
  }

  function draw() {
    if (!alive) return;
    t += 0.012;
    const s = opts.read();
    const f = s.calibrating || !s.valid ? 0.5 : Math.max(0, Math.min(1, s.value));
    const bg = x.createRadialGradient(w * 0.5, h * 0.43, 0, w * 0.5, h * 0.43, Math.max(w, h) * 0.75);
    bg.addColorStop(0, '#154f72'); bg.addColorStop(0.28, '#09233e'); bg.addColorStop(1, '#01040b');
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    x.fillStyle = '#5ac7df18'; x.beginPath(); x.arc(w * 0.18, h * 0.25, 90, 0, 7); x.fill();
    x.fillStyle = '#8b79d820'; x.beginPath(); x.arc(w * 0.84, h * 0.35, 140, 0, 7); x.fill();
    const speed = s.valid ? 0.006 + 0.02 * f : 0.003;
    stars.forEach((p) => {
      p.z -= speed;
      if (p.z < 0.02) { p.z = 1; p.x = (Math.random() - 0.5) * 2; p.y = (Math.random() - 0.5) * 2; }
      const scale = 1 / p.z, px = w / 2 + p.x * w * 0.38 * scale, py = h * 0.43 + p.y * h * 0.34 * scale;
      if (px < 0 || px > w || py < 0 || py > h) return;
      x.globalAlpha = Math.min(1, (1 - p.z) * 1.6); x.fillStyle = '#dffcff';
      x.beginPath(); x.arc(px, py, Math.min(4, p.s * scale), 0, 7); x.fill();
    });
    x.globalAlpha = 1;
    for (let k = 0; k < 4; k++) {
      const z = ((t * 0.18 + k * 0.25) % 1), r = 18 + z * Math.min(w, h) * 0.44;
      x.strokeStyle = `rgba(72,238,231,${0.12 + 0.35 * (1 - z)})`; x.lineWidth = 2 + 4 * (1 - z);
      x.beginPath(); x.ellipse(w / 2, h * 0.43, r * 1.7, r * 0.58, 0, 0, 7); x.stroke();
    }
    // Altitude follows the feedback; eased so the ship glides rather than jumps.
    const target = h * (0.82 - 0.42 * f);
    y = y == null ? target : y + (target - y) * 0.06;
    const wob = (1 - f) * 18 * Math.sin(t * 9);
    ship(w / 2 + wob, y, f);
    x.fillStyle = '#ffffffaa'; x.font = '600 12px system-ui'; x.textAlign = 'center';
    x.fillText(s.label || '', w / 2, h * 0.94);
    requestAnimationFrame(draw);
  }
  draw();
  return { stop() { alive = false; } };
}
