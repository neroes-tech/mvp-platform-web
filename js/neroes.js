// Neroes MVP — entry point, loaded by the single line added to the designer's index.html.
// Wires js/core (signal, session) to the UI adapter. The only data source is the
// local bridge with the headset: there is no simulated or example data here.
import { createSignal } from './core/signal.js';
import { Session } from './core/session.js';
import { installPrototypeAdapter } from './adapter/prototype-v96.js';
import CONFIG from './config.js';

try {
  const signal = await createSignal(CONFIG);
  const core = { cfg: CONFIG, signal, newSession: () => new Session(signal, CONFIG) };
  window.Neroes = core; // for the operator console and the automated tests
  installPrototypeAdapter(core);
  console.info(`[neroes] MVP pronto · ${signal.mode} · ${signal.url}`);
} catch (e) {
  console.error('[neroes] arranque falhou', e);
  const m = document.getElementById('main');
  if (m) m.innerHTML = `<section class="v94"><div class="panel"><h2>Erro ao iniciar o MVP</h2><p>${String(e?.message || e).replace(/[<>&]/g, '')}</p></div></section>`;
  document.getElementById('nrsBoot')?.remove();
}
