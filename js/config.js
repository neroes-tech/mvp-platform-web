// MVP settings. No secrets here: the Supabase key lives only in the bridge's .env.
export default {
  // Bridge WebSocket. null = same origin when served by the bridge, else ws://127.0.0.1:8765/ws.
  bridgeUrl: null,
  bridgeTimeoutMs: 1500,
  // Brain Check (provisional resting reference): seconds per stage, eyes open then closed.
  bcSeconds: 30,
  // Space flight: calibration, then training (seconds).
  calibSeconds: 20,
  gameSeconds: 180,
  feedback: { percentile: 0.5, gain: 1.4, smoothing: 0.25 },
};
