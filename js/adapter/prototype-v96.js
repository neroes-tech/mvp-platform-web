// Adapter for the designer's prototype v9.6 (web/index.html).
//
// This is the ONLY file that knows the prototype: its global functions (go,
// setupTrain, startGame, endGame, gameShell, n94BeginCheck…), its global state
// `S`, its DOM and CSS classes. It replaces the simulated points with live data
// from js/core/. When the final index.html arrives, rewrite this file against
// docs/CONTRATO-UI.md; js/core/ and the bridge do not change.
//
// Simulated points replaced (see docs/PLANO-MVP.md §2):
//   P1 signal quality · P2/P3 Brain Check recording and chart · P4/P5 game and
//   reward bar · P6 session report · P9 persistence.
// Prototype screens built on fixed example values (dashboard and mental map,
// "Report" demo, operator view) are taken out of the navigation: in production
// every number on screen comes from the headset in this session.
import { startSpaceFlight } from '../games/space-flight.js';

/* global S, gameShell */
const st = () => (typeof S !== 'undefined' ? S : { lang: 'EN', segment: 'Corporate' });
const t = (en, pt) => (st().lang === 'PT' ? pt : en);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
// Writes only when the markup changed: the MutationObserver below must not loop.
function setHtml(el, html) {
  if (el && el._mvpHtml !== html) { el.innerHTML = html; el._mvpHtml = html; }
}

const POS = { Fp1: [36, 13], Fp2: [64, 13], F3: [26, 36], F4: [74, 36], C3: [17, 58], C4: [83, 58], Pz: [50, 60], Oz: [50, 85] };
const COLORS = { green: '#55e3cc', yellow: '#f4cd81', red: '#ff7a7a', none: '#3a4f5c' };
const PARTICIPANT_RE = /^[A-Za-z0-9_-]{2,32}$/;

export function installPrototypeAdapter(core) {
  const { cfg, signal } = core;
  let session = core.newSession();
  let participant = '';
  let game = null;
  let bcState = null; // null | 'analysing' | 'done' | 'error'
  let bcError = '';
  let lastActionsKey = '';
  let msgText = '';

  injectCss();
  const BC = window.n94BrainCheck;
  if (BC) BC.seconds = cfg.bcSeconds;

  // ------------------------------------------------------------------ labels
  function modeLabel() {
    return {
      live: t('LIVE · headset', 'AO VIVO · headset'),
      sim: t('DEVELOPER MODE · simulated signal', 'MODO DE DESENVOLVIMENTO · sinal simulado'),
      replay: t('DEVELOPER MODE · recording replay', 'MODO DE DESENVOLVIMENTO · reprodução'),
      offline: t('NO HEADSET CONNECTION', 'SEM LIGAÇÃO AO HEADSET'),
    }[signal.mode] || signal.mode;
  }
  function headsetState() {
    const s = signal.state.status;
    if (!signal.connected) return { cls: 'off', text: t('Waiting for the headset bridge on this PC…', 'À espera da bridge do headset neste PC…') };
    if (!s) return { cls: 'wait', text: t('Connecting…', 'A ligar…') };
    if (s.state !== 'streaming') return { cls: 'off', text: `${t('Headset', 'Headset')}: ${s.state}${s.detail ? ' · ' + s.detail : ''}` };
    if (!s.settled) return { cls: 'wait', text: t(`Stabilising signal · ${Math.ceil(s.settle_remaining_s)} s`, `A estabilizar o sinal · ${Math.ceil(s.settle_remaining_s)} s`) };
    return { cls: 'ok', text: t('Headset streaming', 'Headset a adquirir') };
  }
  function modeBadge() {
    return `<span class="mvpMode mvp-${signal.mode}" data-mvp="mode">● ${esc(modeLabel())}</span>`;
  }

  // ------------------------------------------------------------ view helper
  function show(view, html) {
    const g = document.getElementById('game');
    if (g && !game) { g.classList.add('hidden'); g.innerHTML = ''; }
    S.view = view;
    const m = document.getElementById('main');
    m.dataset.view = view;
    m.className = '';
    m.innerHTML = html;
    window.nHeader?.();
    window.scrollTo(0, 0);
    refresh();
  }
  function msg(text) {
    msgText = text || '';
    const el = $('#mvpMsg');
    if (el) el.textContent = msgText;
  }

  // ------------------------------------------------------- electrode views
  function electrodeSvg(q, small = false) {
    const names = q?.channels?.length ? q.channels.map((c) => c.name) : (signal.state.hello?.channels || Object.keys(POS));
    const byName = Object.fromEntries((q?.channels || []).map((c) => [c.name, c]));
    const dots = names.map((n) => {
      const c = byName[n], p = POS[n] || [50, 50];
      // `unknown` / null score = not measured yet: grey and no number (TRIGGERS §3.1).
      const measured = c && c.score != null && c.level !== 'unknown';
      const color = measured ? (COLORS[c.level] || COLORS.none) : COLORS.none;
      const score = measured ? Math.round(c.score) : '–';
      return `<g><circle cx="${p[0]}" cy="${p[1]}" r="7.2" fill="${color}" fill-opacity="${measured ? 0.9 : 0.4}" stroke="#0c141c" stroke-width="1"/>`
        + `<text x="${p[0]}" y="${p[1] + 2.2}" text-anchor="middle" font-size="5.6" font-weight="700" fill="#082028">${score}</text>`
        + `<text x="${p[0]}" y="${p[1] + 13}" text-anchor="middle" font-size="4.6" fill="#b7cbd5">${esc(n)}${c && c.counts === false ? '*' : ''}</text></g>`;
    }).join('');
    return `<svg class="mvpHeadSvg${small ? ' small' : ''}" viewBox="0 -4 100 108" role="img" aria-label="${t('Electrode quality', 'Qualidade dos elétrodos')}">`
      + '<circle cx="50" cy="52" r="46" fill="#55e3cc08" stroke="#ffffff30"/><path d="M44 7 L50 -2 L56 7" fill="none" stroke="#ffffff30"/>'
      + '<path d="M3 46 Q-2 52 3 58 M97 46 Q102 52 97 58" fill="none" stroke="#ffffff30"/>' + dots + '</svg>';
  }

  function qualityText(q) {
    const hs = headsetState();
    let html = `<p class="mvpState mvp-${hs.cls}">${esc(hs.text)}${signal.state.status?.battery != null ? ` · ${t('battery', 'bateria')} ${Math.round(signal.state.status.battery)}%` : ''}</p>`;
    if (!signal.connected) {
      return html + `<p class="note">${t('Start the bridge on the PC with the headset (bridge\\iniciar.bat). This page connects by itself; no value is shown until the headset is streaming.', 'Inicia a bridge no PC com o headset (bridge\\iniciar.bat). Esta página liga-se sozinha; nenhum valor é mostrado enquanto o headset não estiver a adquirir.')}</p>`;
    }
    if (!q?.measured) return html + `<p class="note">${t('Measuring the first 6 s of signal…', 'A medir os primeiros 6 s de sinal…')}</p>`;
    // The mean never travels alone: how many channels made it (TRIGGERS §3.2).
    html += `<p><b>${t('Average', 'Média')} ${Math.round(q.mean)}/100</b> ${t('over', 'em')} ${q.n_channels} ${t('channels', 'canais')} · ${t('worst', 'pior')} ${esc(q.worst_channel)} ${Math.round(q.worst)}</p>`;
    const bad = q.channels.filter((c) => c.counts !== false && c.level !== 'green' && c.level !== 'unknown');
    if (bad.length) {
      html += '<ul class="mvpReasons">' + bad.map((c) => `<li><b style="color:${COLORS[c.level]}">${esc(c.name)}</b> ${esc(faultLabel(c.fault))}</li>`).join('') + '</ul>';
    }
    html += actionHtml(signal.state.warning);
    const opt = q.channels.filter((c) => c.counts === false).map((c) => c.name);
    if (opt.length) html += `<p class="note">* ${esc(opt.join(', '))}: ${t('not counted in the average (still measured and recorded).', 'não contam para a média (continuam a ser medidos e gravados).')}</p>`;
    return html;
  }

  const FAULTS_EN = { 'canal morto': 'dead channel', 'contacto ruidoso': 'noisy contact', musculo: 'muscle', movimento: 'movement', 'amostras perdidas': 'lost samples', 'sem contacto (global)': 'no contact (whole cap)' };
  function faultLabel(f) { return !f ? '' : st().lang === 'PT' ? f : (FAULTS_EN[f] || f); }

  // unicornbench's action (TRIGGERS §4), latched by core/signal.js: shown while the
  // same cause persists. `recommends_ending` is a recommendation, never an order —
  // the operator decides here.
  function actionHtml(a) {
    if (!a) return '';
    if (a.recommends_ending) {
      const ch = (a.channels || []).filter((c) => !(signal.state.quality?.excluded || []).includes(c));
      return `<div class="mvpDecide"><b>${t('The signal module recommends ending the session', 'O módulo de sinal recomenda terminar a sessão')}</b>
        <p>${esc(a.message)}</p><p class="note">${t('It is a recommendation, not an order: you decide. The message is about the equipment, not the person.', 'É uma recomendação, não uma ordem: decides tu. A mensagem é sobre o equipamento, não sobre a pessoa.')}</p>
        <div class="actions">${ch.length ? `<button class="secondary" onclick="mvp.exclude(${esc(JSON.stringify(ch))})">${t('Continue without', 'Continuar sem')} ${esc(ch.join(', '))}</button>` : ''}
        ${session.active ? `<button class="secondary" onclick="mvp.endSession()">${t('End the session properly', 'Terminar a sessão')}</button>` : ''}</div></div>`;
    }
    const insist = a.directive === 'insistir';
    return `<p class="mvpAlert${insist ? ' insist' : ' warn'}">${insist ? '⚠ ' : ''}${esc(a.message)}</p>`;
  }

  function qualityOk(q) {
    if (!q?.measured) return false;
    const red = q.channels.filter((c) => c.level === 'red' && c.counts !== false);
    return red.length === 0 && (q.mean ?? 0) >= (signal.state.hello?.clean_bar ?? 70);
  }

  // ------------------------------------------------------------- checklist
  function checklist() {
    const s = signal.state.status, q = signal.state.quality;
    const items = [
      [signal.connected && s?.state === 'streaming', t('Headset connected', 'Headset ligado')],
      // Nothing is claimed before there is a measurement.
      [Boolean(s?.settled), s?.state === 'streaming' && !s.settled ? t(`Signal stabilising (${Math.ceil(s.settle_remaining_s)} s)`, `Sinal a estabilizar (${Math.ceil(s.settle_remaining_s)} s)`) : t('Signal stabilised', 'Sinal estabilizado')],
      [qualityOk(q), q?.measured && !qualityOk(q) ? t('Electrodes need attention', 'Elétrodos a precisar de atenção') : t('Electrodes OK', 'Elétrodos OK'), Boolean(q?.measured && !qualityOk(q))],
      [session.active || session.finished, session.started ? `${t('Session started', 'Sessão iniciada')} · ${esc(session.participant)}` : t('Session started', 'Sessão iniciada')],
      [bcState === 'done', t('Resting reference (Brain Check)', 'Referência em repouso (Brain Check)')],
      [Boolean(session.game?.endedAt), t('Training (space flight)', 'Treino (voo espacial)')],
      [Boolean(session.result?.saved?.ok), session.result && !session.result.saved?.ok ? t('Session saved locally (cloud: see report)', 'Sessão guardada localmente (cloud: ver relatório)') : t('Session saved', 'Sessão guardada')],
    ];
    return items.map(([ok, label, warn]) => `<li class="${ok ? 'done' : warn ? 'warn' : ''}"><i>${ok ? '✓' : warn ? '!' : '○'}</i>${label}</li>`).join('');
  }

  function actions() {
    const ready = signal.state.status?.settled && signal.state.status?.state === 'streaming';
    const dis = ready ? '' : ' disabled';
    if (session.finished) return [`<button class="primary" onclick="mvp.showReport()">${t('View report →', 'Ver relatório →')}</button>`, `<button class="secondary" onclick="mvp.newSession()">${t('New session', 'Nova sessão')}</button>`];
    if (session.game?.endedAt) return [`<button class="primary" onclick="mvp.showReport()">${t('View report →', 'Ver relatório →')}</button>`];
    if (bcState === 'done') return [`<button class="primary"${dis} onclick="mvp.startTraining()">${t(`Start training (${Math.round(cfg.gameSeconds / 60)} min) →`, `Começar treino (${Math.round(cfg.gameSeconds / 60)} min) →`)}</button>`];
    return [
      `<button class="primary"${dis} onclick="mvp.startBrainCheck()">${t('Start Brain Check →', 'Começar Brain Check →')}</button>`,
      `<button class="secondary"${dis} onclick="mvp.startTraining()">${t('Skip to training', 'Saltar para o treino')}</button>`,
    ];
  }

  // --------------------------------------------------------- setup screen
  function setupHtml() {
    return `<section class="v94 mvp" data-mvp="setup">
      <div class="intro"><div><div class="kicker">${t('MVP SESSION · SPACE FLIGHT', 'SESSÃO MVP · VOO ESPACIAL')}</div>
        <h1>${t('Put on the headset.', 'Coloca o headset.')}</h1>
        <p>${t('Check the electrodes, then follow the steps: resting reference, then training.', 'Confirma os elétrodos e segue os passos: referência em repouso e depois treino.')}</p></div>${modeBadge()}</div>
      <div class="reportGrid">
        <div class="panel"><div class="kicker">${t('ELECTRODE QUALITY · LIVE', 'QUALIDADE DOS ELÉTRODOS · AO VIVO')}</div>
          <div class="mvpHead" id="mvpHead">${electrodeSvg(signal.state.quality)}</div>
          <div id="mvpQualityText" class="mvpQualityText">${qualityText(signal.state.quality)}</div></div>
        <div class="panel"><div class="kicker">${t('WHAT HAS BEEN DONE', 'O QUE JÁ FOI FEITO')}</div>
          <ul class="mvpChecklist" id="mvpChecklist">${checklist()}</ul>
          <label class="mvpField">${t('Participant code', 'Código do participante')}
            <input id="mvpParticipant" autocomplete="off" maxlength="32" placeholder="P001" value=""${esc(session.started ? session.participant : participant)}" ${session.started ? 'disabled' : ''} oninput="mvp.setParticipant(this.value)"></label>
          <div class="actions" id="mvpActions">${actions().join('')}</div>
          <p class="note" id="mvpMsg">${esc(msgText)}</p>
        </div>
      </div></section>`;
  }
  function mvpSetup() { lastActionsKey = ''; show('setup', setupHtml()); }

  // ------------------------------------------------------------- session
  async function ensureSession() {
    if (session.active) return true;
    if (session.finished) session = core.newSession();
    const code = (participant || '').trim();
    if (!PARTICIPANT_RE.test(code)) { msg(t('Enter the participant code (letters or digits, e.g. P001).', 'Escreve o código do participante (letras ou números, ex.: P001).')); return false; }
    const s = signal.state.status;
    if (!signal.connected || s?.state !== 'streaming') { msg(t('The headset is not streaming yet.', 'O headset ainda não está a adquirir.')); return false; }
    if (!s.settled) { msg(t(`Signal stabilising: ${Math.ceil(s.settle_remaining_s)} s`, `O sinal está a estabilizar: ${Math.ceil(s.settle_remaining_s)} s`)); return false; }
    try {
      await session.start(code, { segment: st().segment, lang: st().lang, mode: signal.mode });
      msg('');
      return true;
    } catch (e) {
      msg(String(e.message || e));
      return false;
    }
  }

  // ------------------------------------------------------------ Brain Check
  async function startBrainCheck() {
    if (!(await ensureSession())) return;
    bcState = null;
    window.go('measure');
  }

  const origBegin = window.n94BeginCheck;
  window.n94BeginCheck = async function () {
    if (!(await ensureSession())) { mvpSetup(); return; }
    bcState = null; bcError = '';
    await session.mark('bc_eyes_open', { seconds_per_stage: BC.seconds });
    origBegin();
  };

  let prevStep = BC ? BC.step : 0;
  setInterval(() => {
    if (!BC) return;
    const s = BC.step, p = prevStep;
    if (s === p) return;
    prevStep = s;
    if (!session.active) return;
    if (p === 1 && s === 2) session.mark('bc_eyes_closed');
    else if (p === 2 && s === 3) finishBrainCheck();
    else if ((p === 1 || p === 2) && s === 0) session.mark('bc_cancel');
  }, 150);

  async function finishBrainCheck() {
    bcState = 'analysing';
    renderBc();
    await session.mark('bc_end');
    try {
      await session.analyseBrainCheck();
      bcState = 'done';
    } catch (e) {
      bcState = 'error';
      bcError = String(e.message || e);
    }
    renderBc();
  }

  function renderBc() {
    if (S.view !== 'measure' || !BC || BC.step !== 3) return;
    const m = document.getElementById('main');
    m.innerHTML = bcHtml();
    refresh();
  }

  function bcHtml() {
    const r = session.brainCheck;
    const head = `<div class="intro"><div><div class="kicker">BRAIN CHECK · ${t('RESTING REFERENCE', 'REFERÊNCIA EM REPOUSO')}</div><h1>${t('Your resting reference.', 'A tua referência em repouso.')}</h1></div>${modeBadge()}</div>`;
    if (bcState === 'analysing') return `<section class="v94" data-mvp="bc">${head}<div class="panel"><p>${t('Analysing the recording…', 'A analisar a gravação…')}</p></div></section>`;
    if (bcState === 'error' || !r) return `<section class="v94" data-mvp="bc">${head}<div class="panel"><p class="mvpAlert">${esc(bcError || t('No result.', 'Sem resultado.'))}</p><div class="actions"><button class="primary" onclick="mvp.setup()">${t('Back to setup', 'Voltar à preparação')}</button></div></div></section>`;
    if (!r.valid) {
      return `<section class="v94" data-mvp="bc">${head}<div class="panel"><p class="mvpAlert">${t('Not enough clean signal in both stages to compute the reference.', 'Não houve sinal limpo suficiente nas duas fases para calcular a referência.')}</p><p class="note">${esc(r.reason || '')}</p><div class="actions"><button class="primary" onclick="mvp.startBrainCheck()">${t('Repeat Brain Check', 'Repetir Brain Check')}</button><button class="secondary" onclick="mvp.startTraining()">${t('Continue to training', 'Continuar para o treino')}</button></div></div></section>`;
    }
    const tl = (r.timeline || []).map((v) => (v == null ? 0 : v));
    const split = r.split_index ?? Math.floor(tl.length / 2);
    const bands = r.bands_rel_closed || {};
    const bandRows = [['theta', 'Theta', '4–8 Hz', '#75a9dd'], ['alpha', 'Alpha', '8–12 Hz', '#55e3cc'], ['low_beta', t('Low beta', 'Beta baixa'), '12–16 Hz', '#9385df'], ['high_beta', t('High beta', 'Beta alta'), '16–25 Hz', '#ca96dd'], ['gamma', 'Gamma', '25–45 Hz', '#d5b171']];
    const react = r.alpha_reactivity_db;
    return `<section class="v94" data-mvp="bc">${head}
      <div class="reportGrid">
        <div class="panel"><div class="kicker">${t('RELATIVE ALPHA (8–12 Hz) · EVERY 2 s', 'ALFA RELATIVO (8–12 Hz) · A CADA 2 s')}</div>
          <h2>${t('Eyes open, then eyes closed.', 'Olhos abertos, depois olhos fechados.')}</h2>
          ${chart(tl, null, t('% alpha', '% alfa'), t('Relative alpha during the resting reference', 'Alfa relativo durante a referência em repouso'), split, t('Time', 'Tempo'))}
          <div class="chartLegend"><span>${t('Left of the line: eyes open', 'À esquerda da linha: olhos abertos')}</span><span>${t('Right: eyes closed', 'À direita: olhos fechados')}</span></div></div>
        <div class="panel"><div class="kicker">${t('SUMMARY', 'RESUMO')}</div>
          <h2>${t('Reference complete ✓', 'Referência concluída ✓')}</h2>
          <div class="comparison"><b>${t('Open', 'Abertos')}</b><span><i style="width:${Math.min(100, r.alpha_rel.open * 100)}%;background:#718697"></i></span><b>${(r.alpha_rel.open * 100).toFixed(0)}%</b></div>
          <div class="comparison"><b>${t('Closed', 'Fechados')}</b><span><i style="width:${Math.min(100, r.alpha_rel.closed * 100)}%"></i></span><b>${(r.alpha_rel.closed * 100).toFixed(0)}%</b></div>
          <p>${t('Alpha reactivity', 'Reatividade alfa')}: <b>${react == null ? '—' : (react >= 0 ? '+' : '') + react.toFixed(1) + ' dB'}</b> · ${t('alpha peak', 'pico alfa')}: <b>${r.iaf_hz == null ? t('not detected', 'não detetado') : r.iaf_hz.toFixed(1) + ' Hz'}</b></p>
          <p class="note">${t('Channels', 'Canais')}: ${esc((r.channels || []).join(', '))}. ${t('Provisional reference (eyes open/closed) computed from this recording. It is not the validated Brain Check and not a diagnosis.', 'Referência provisória (olhos abertos/fechados) calculada a partir desta gravação. Não é o Brain Check validado nem um diagnóstico.')}</p>
          <div class="actions"><button class="primary" onclick="mvp.startTraining()">${t('Start training →', 'Começar treino →')}</button><button class="secondary" onclick="mvp.setup()">${t('Setup', 'Preparação')}</button></div></div>
      </div>
      <details open><summary>${t('Band power with eyes closed (relative %)', 'Potência por banda de olhos fechados (% relativa)')}</summary>
        <div class="eeg">${bandRows.map(([k, n, hz, col]) => `<div><span class="bar" style="height:${Math.round((bands[k] || 0) * 300)}px;background:${col}"></span><b>${Math.round((bands[k] || 0) * 100)}%</b><small>${n}<br>${hz}</small></div>`).join('')}</div>
      </details></section>`;
  }

  // ---------------------------------------------------------------- game
  async function startTraining() {
    if (game) return;
    if (!(await ensureSession())) { if (S.view !== 'setup') mvpSetup(); return; }
    const fb = signal.feedback;
    const canvas = gameShell('SPACE FLIGHT', t('Relax and watch the ship.', 'Relaxa e observa a nave.'));
    game = { phase: 'calib', calibStart: performance.now(), trainStart: null, calibSeconds: cfg.calibSeconds, extensions: 0, inTargetSince: null, rewards: 0 };
    fixHud();
    fb.startCalibration();
    await session.mark('game_calib_start', { seconds: cfg.calibSeconds });
    game.flight = startSpaceFlight(canvas, {
      read: () => ({ value: fb.value, valid: fb.valid, calibrating: game?.phase === 'calib', label: hudLabel() }),
    });
    game.unsub = signal.on('features', () => { if (game) session.sample(gameTime(), fb, signal.state.quality); });
    game.timer = setInterval(gameTick, 250);
  }

  function gameTime() {
    if (!game) return 0;
    if (game.phase === 'calib') return -Math.max(0, game.calibSeconds - (performance.now() - game.calibStart) / 1000);
    return (performance.now() - game.trainStart) / 1000;
  }

  function fmt(s) { s = Math.max(0, Math.ceil(s)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }

  function hudLabel() {
    if (!game) return '';
    if (game.phase === 'calib') return `${t('CALIBRATING', 'A CALIBRAR')} · ${fmt(-gameTime())}`;
    return `${t('TRAINING', 'TREINO')} · ${fmt(cfg.gameSeconds - gameTime())}`;
  }

  function fixHud() {
    const g = document.getElementById('game');
    const hud = g.querySelector('.hud');
    if (hud) {
      const title = hud.querySelector('div > div');
      if (title) title.textContent = t('SPACE FLIGHT · DEEP FOCUS', 'VOO ESPACIAL · FOCO PROFUNDO');
      const right = hud.lastElementChild;
      if (right) right.textContent = `${modeLabel()} · NEUROFEEDBACK`;
    }
    const ms = g.querySelector('.gameMilestone');
    if (ms) ms.innerHTML = `${t('PARTICIPANT', 'PARTICIPANTE')} ${esc(session.participant)}<b id="gameGoal">${t('Calibrating', 'A calibrar')}</b>`;
    const exit = g.querySelector('.gameExit');
    if (exit) exit.textContent = t('End session', 'Terminar sessão');
  }

  async function gameTick() {
    if (!game) return;
    const fb = signal.feedback;
    const instr = $('#instr'), goal = $('#gameGoal'), fill = $('#rewardFill');
    if (game.phase === 'calib' && gameTime() >= 0) {
      if (fb.endCalibration()) {
        game.phase = 'train';
        game.trainStart = performance.now();
        session.game = { calibration: { threshold: fb.threshold, spread: fb.spread, n: fb.calib.length, seconds: game.calibSeconds + 10 * game.extensions } };
        session.mark('game_start', { threshold: fb.threshold, spread: fb.spread, n_calibration: fb.calib.length });
      } else if (game.extensions < 3) {
        game.extensions += 1;
        game.calibSeconds += 10;
        fb.calibrating = true;
        session.mark('game_calib_extended', { valid_values: fb.calib.length });
      } else {
        session.mark('game_calib_failed', { valid_values: fb.calib.length });
        await endTraining(true, t('Not enough valid signal to calibrate. Check the electrodes.', 'Sinal válido insuficiente para calibrar. Verifica os elétrodos.'), true);
        return;
      }
    }
    if (game.phase === 'train' && gameTime() >= cfg.gameSeconds) { await endTraining(false); return; }
    if (fill) fill.style.height = `${Math.round((game.phase === 'calib' ? 0.5 : fb.value) * 100)}%`;
    // Precedence from unicornbench's TRIGGERS §8: device state, then the action, then the exercise.
    const st0 = signal.state.status, act = signal.state.warning;
    if (instr) {
      instr.textContent = !signal.connected || (st0 && st0.state !== 'streaming')
        ? `${t('Headset without signal', 'Headset sem sinal')}${st0?.detail ? ' — ' + st0.detail : ''}`
        : act?.should_act && !act.recommends_ending ? act.message
          : !fb.valid ? t('Weak signal — adjust the headset', 'Sinal fraco — ajustar o headset')
            : game.phase === 'calib' ? t('Relax and watch the ship.', 'Relaxa e observa a nave.')
              : t('Find the state that lifts the ship.', 'Encontra o estado que faz subir a nave.');
    }
    const g = document.getElementById('game');
    let decide = g && g.querySelector('#mvpDecideGame');
    if (act?.recommends_ending) {
      if (!decide && g) { decide = document.createElement('div'); decide.id = 'mvpDecideGame'; decide.className = 'mvpDecideGame'; g.appendChild(decide); }
      setHtml(decide, actionHtml(act));
    } else if (decide) decide.remove();
    if (goal) goal.textContent = game.phase === 'calib' ? t('Calibrating', 'A calibrar') : `${Math.round(fb.value * 100)} / 100`;
    if (game.phase === 'train' && fb.valid && fb.inTarget) {
      game.inTargetSince ??= performance.now();
      const held = (performance.now() - game.inTargetSince) / 1000;
      if (held >= 10 * (game.rewards + 1)) {
        game.rewards += 1;
        const pop = $('#rewardPop');
        if (pop) { pop.textContent = `${t('STATE HELD', 'ESTADO MANTIDO')} · ${Math.round(held)} s`; pop.classList.add('show'); setTimeout(() => pop.classList.remove('show'), 950); }
        window.rewardTone?.(Math.min(game.rewards, 3));
      }
    } else if (game) {
      game.inTargetSince = null;
      game.rewards = 0;
    }
  }

  async function endTraining(early, reason = '', calibFailed = false) {
    if (!game) return;
    const g0 = game;
    game = null;
    clearInterval(g0.timer);
    g0.unsub?.();
    g0.flight?.stop();
    const trained = g0.phase === 'train' ? (performance.now() - g0.trainStart) / 1000 : 0;
    await session.mark('game_end', { early, trained_s: Math.round(trained), reason });
    if (session.game) session.game.endedAt = new Date().toISOString();
    else session.game = { calibration: null, endedAt: new Date().toISOString() };
    const el = document.getElementById('game');
    el.classList.add('hidden');
    el.innerHTML = '';
    // Calibration failed for lack of valid signal: back to setup, the session goes on.
    if (calibFailed) { msg(reason); session.game = null; mvpSetup(); return; }
    show('sessionreport', `<section class="v94" data-mvp="saving"><div class="panel"><h2>${t('Saving the session…', 'A guardar a sessão…')}</h2><p>${t('Closing the recording and sending it to the backend.', 'A fechar a gravação e a enviá-la para o backend.')}</p></div></section>`);
    await session.finish();
    showReport();
  }

  // --------------------------------------------------------------- report
  function showReport() {
    if (!session.result) {
      show('sessionreport', `<section class="v94" data-mvp="report-empty"><div class="intro"><div><div class="kicker">${t('SESSION REPORT', 'RELATÓRIO DA SESSÃO')}</div><h1>${t('No session yet.', 'Ainda não há sessões.')}</h1></div>${modeBadge()}</div><div class="panel"><p>${t('The report appears here at the end of a session with the headset.', 'O relatório aparece aqui no fim de uma sessão com o headset.')}</p><div class="actions"><button class="primary" onclick="mvp.setup()">${t('Go to the session →', 'Ir para a sessão →')}</button></div></div></section>`);
      return;
    }
    show('sessionreport', reportHtml(session.result));
  }

  function reportHtml(res) {
    const sm = res.row.summary || {};
    const train = (res.row.series || []).filter((x) => x.t >= 0);
    const vals = downsample(train.map((x) => (x.raw == null ? null : x.raw * 100)), 120);
    const thr = sm.calibration?.threshold != null ? sm.calibration.threshold * 100 : null;
    const base = thr == null ? null : vals.map(() => thr);
    const saved = res.saved || {};
    const verdict = res.stop?.quality_verdict;
    const bc = res.row.brain_check;
    const pct = sm.time_in_target_pct;
    const first = sm.mean_raw_first_third, last = sm.mean_raw_last_third;
    const live = (res.stop?.mode || signal.mode) === 'live';
    const savedLine = saved.ok ? `<p class="success">✓ ${t('Saved to Supabase (session + EEG files).', 'Guardada no Supabase (sessão + ficheiros EEG).')}</p>`
      : !live ? `<p class="note">${t('Developer-mode session (simulated signal): not saved to the cloud.', 'Sessão em modo de desenvolvimento (sinal simulado): não é guardada na cloud.')}</p>`
        : `<p class="mvpAlert">${t('Not saved to the cloud', 'Não guardada na cloud')}: ${esc(saved.skipped || saved.error || '—')}</p>`;
    return `<section class="v94" data-mvp="report">
      <div class="intro"><div><div class="kicker">${t('SESSION REPORT', 'RELATÓRIO DA SESSÃO')} · ${esc(res.row.participant_code)}</div><h1>${t('How your session went.', 'Como correu a tua sessão.')}</h1></div>${modeBadge()}</div>
      <div class="reportGrid">
        <div class="panel"><div class="kicker">${t('TRAINING SIGNAL · RELATIVE ALPHA (%)', 'SINAL DE TREINO · ALFA RELATIVO (%)')}</div>
          <h2>${t('What the ship followed.', 'O que a nave seguiu.')}</h2>
          ${vals.length > 1 ? chart(vals, base, t('% alpha', '% alfa'), t('Relative alpha during training and calibration threshold', 'Alfa relativo durante o treino e limiar da calibração'), null, t('Training time', 'Tempo de treino'), `${Math.round(sm.training_s || 0)} s`) : `<p class="note">${t('No training samples.', 'Sem amostras de treino.')}</p>`}
          <div class="chartLegend"><span><i></i>${t('This session', 'Esta sessão')}</span>${thr == null ? '' : `<span><i class="base"></i>${t('Threshold (calibration)', 'Limiar (calibração)')}</span>`}</div></div>
        <div class="panel">${pct == null ? `<p class="note">${t('No valid samples to compute time in target.', 'Sem amostras válidas para calcular o tempo no alvo.')}</p>` : gauge(Math.round(pct), t('TIME ABOVE THRESHOLD', 'TEMPO ACIMA DO LIMIAR'))}
          ${first != null && last != null ? `<div class="comparison"><b>${t('1st third', '1.º terço')}</b><span><i style="width:${Math.min(100, first * 100)}%;background:#718697"></i></span><b>${(first * 100).toFixed(0)}%</b></div><div class="comparison"><b>${t('Last third', 'Último terço')}</b><span><i style="width:${Math.min(100, last * 100)}%"></i></span><b>${(last * 100).toFixed(0)}%</b></div>` : ''}
          <p class="note">${t('Mean relative alpha at the start and at the end of training.', 'Alfa relativo médio no início e no fim do treino.')}</p></div>
      </div>
      <div class="grid">
        <div class="panel metric"><div class="kicker">${t('TRAINING', 'TREINO')}</div><strong>${fmt(sm.training_s || 0)}</strong><small>${t('valid signal', 'sinal válido')}: ${sm.valid_pct ?? '—'}% · ${t('interruptions', 'interrupções')}: ${res.row.restarts ?? 0}</small></div>
        <div class="panel metric"><div class="kicker">${t('SIGNAL QUALITY', 'QUALIDADE DO SINAL')}</div><strong>${verdict?.usable_fraction != null ? Math.round(verdict.usable_fraction * 100) + '%' : (sm.quality_mean != null ? Math.round(sm.quality_mean) + '/100' : '—')}</strong><small title="${esc(verdict?.one_line || '')}">${verdict?.usable_fraction != null ? `${verdict.usable ? t('Usable recording', 'Gravação utilizável') : t('Below the quality bar', 'Abaixo da barra de qualidade')} · ${t('worst channel above the line', 'pior canal acima da linha')} ${Math.round(verdict.usable_fraction * 100)}% ${t('of the time', 'do tempo')}` : t('Average electrode score during training.', 'Pontuação média dos elétrodos durante o treino.')}</small></div>
        <div class="panel metric"><div class="kicker">${t('RESTING REFERENCE', 'REFERÊNCIA EM REPOUSO')}</div><strong>${bc?.valid ? (bc.iaf_hz != null ? bc.iaf_hz.toFixed(1) + ' Hz' : '—') : '—'}</strong><small>${bc?.valid ? `${t('alpha peak', 'pico alfa')} · ${t('reactivity', 'reatividade')} ${bc.alpha_reactivity_db >= 0 ? '+' : ''}${bc.alpha_reactivity_db.toFixed(1)} dB` : t('not done', 'não realizada')}</small></div>
      </div>
      <div class="panel mvpSaved"><div class="kicker">${t('STORAGE', 'GRAVAÇÃO')}</div>
        ${res.stop ? `<p>✓ ${t('Recorded by the bridge', 'Gravada pela bridge')}: <code>${esc(res.stop.dir)}</code></p>` : `<p class="mvpAlert">${t('The bridge did not confirm the recording', 'A bridge não confirmou a gravação')}: ${esc(res.stopError)}</p>`}
        ${savedLine}</div>
      <p class="note" style="margin-top:18px">${t('Values computed from this session\'s EEG: relative alpha (8–12 Hz over 1–30 Hz) on posterior/central electrodes, threshold from the first seconds of the exercise. MVP training indicator, not a validated biomarker or a diagnosis.', 'Valores calculados a partir do EEG desta sessão: alfa relativo (8–12 Hz sobre 1–30 Hz) nos elétrodos posteriores/centrais, limiar a partir dos primeiros segundos do exercício. Indicador de treino do MVP, não é um biomarcador validado nem um diagnóstico.')}</p>
      <div class="actions"><button class="primary" onclick="mvp.newSession()">${t('New session', 'Nova sessão')}</button></div>
    </section>`;
  }

  function newSession() {
    if (session.active) return;
    session = core.newSession();
    participant = '';
    bcState = null;
    msgText = '';
    signal.feedback.reset();
    mvpSetup();
  }

  // ------------------------------------------------- prototype overrides
  // The prototype footer says "all data shown is simulated": replace it with what is true.
  window.v84Footer = function () {
    const e = document.getElementById('v84Footer');
    if (!e) return;
    const txt = {
      live: t('Neroes MVP · research use. Every value shown comes from the headset in this session. Not a medical device. Does not diagnose or treat.',
        'MVP Neroes · uso em investigação. Todos os valores mostrados vêm do headset nesta sessão. Não é um dispositivo médico. Não diagnostica nem trata.'),
      offline: t('Neroes MVP · waiting for the headset. Not a medical device. Does not diagnose or treat.',
        'MVP Neroes · à espera do headset. Não é um dispositivo médico. Não diagnostica nem trata.'),
    }[signal.mode] || t('DEVELOPER MODE · simulated signal for automated tests, not for participants. Nothing is saved to the cloud.',
      'MODO DE DESENVOLVIMENTO · sinal simulado para testes automáticos, não para participantes. Nada é guardado na cloud.');
    if (e.textContent !== txt) e.textContent = txt;
  };
  // The operator's two answers to `recommends_ending` (TRIGGERS §4.5).
  async function excludeChannels(channels) {
    try {
      await signal.request('exclude', { channels });
      session._log?.('operator_exclude', { channels });
    } catch (e) { msg(String(e.message || e)); }
  }
  async function endSession() {
    if (game) { await endTraining(true, 'operator_after_usq_recommendation'); return; }
    if (!session.active) return;
    show('sessionreport', `<section class="v94" data-mvp="saving"><div class="panel"><h2>${t('Saving the session…', 'A guardar a sessão…')}</h2></div></section>`);
    await session.finish();
    showReport();
  }

  window.mvp = {
    setup: mvpSetup, startBrainCheck, startTraining, showReport, newSession,
    exclude: excludeChannels, endSession,
    setParticipant: (v) => { participant = v; },
    get session() { return session; },
  };
  window.setupTrain = mvpSetup;
  window.startGame = startTraining;
  window.startRewardSystem = () => {}; // the HUD bar is driven by gameTick()
  const origEnd = window.endGame;
  window.endGame = () => (game ? endTraining(true) : origEnd());
  // Prototype views built on fixed example values never render: the session screen
  // is home, and "Report" shows the real report (or an empty state).
  window.sessionReport = showReport;
  window.finalReport = showReport;
  window.participantProfile = mvpSetup;
  window.operatorView = mvpSetup;
  const origGo = window.go;
  window.go = function (v) {
    if (['nextsession', 'setup', 'home', 'landing', 'operator', 'profile'].includes(v)) return mvpSetup();
    if (v === 'progress' || v === 'sessionreport') return showReport();
    return origGo.apply(this, arguments);
  };
  window.goHome = mvpSetup;

  // ------------------------------------------- live refresh + decorations
  function refresh() {
    decorateHeader();
    const view = S.view;
    if (view === 'setup') {
      setHtml($('#mvpHead'), electrodeSvg(signal.state.quality));
      setHtml($('#mvpQualityText'), qualityText(signal.state.quality));
      setHtml($('#mvpChecklist'), checklist());
      const acts = actions();
      const key = acts.join('');
      const box = $('#mvpActions');
      if (box && key !== lastActionsKey) { box.innerHTML = key; lastActionsKey = key; }
    }
    if (view === 'measure') decorateMeasure();
    if (view === 'how' || view === 'selected') decorateIllustration();
    window.v84Footer();
  }

  // Explanatory/catalogue pages carry the prototype's "simulated data" badge and note;
  // they show no data, so say what they are.
  function decorateIllustration() {
    const m = document.getElementById('main');
    for (const b of m.querySelectorAll('.v94 .demo')) {
      const txt = S.view === 'how' ? t('ILLUSTRATION', 'ILUSTRAÇÃO') : t('CATALOGUE', 'CATÁLOGO');
      if (b.textContent !== txt) b.textContent = txt;
    }
    for (const n of m.querySelectorAll('.v94 p.note')) {
      if (/simulat|simula/i.test(n.textContent)) n.textContent = t('Conceptual illustration of the neurofeedback loop. In a session, the response comes from the headset.', 'Ilustração conceptual do ciclo de neurofeedback. Numa sessão, a resposta vem do headset.');
    }
  }

  function decorateHeader() {
    const row = document.querySelector('.top .row');
    if (!row) return;
    let b = row.querySelector('.mvpBadge');
    if (!b) {
      b = document.createElement('button');
      b.className = 'mvpBadge';
      b.type = 'button';
      b.onclick = () => mvpSetup();
      row.prepend(b);
    }
    const nav = row.querySelectorAll('.nNav button');
    if (nav[0] && nav[0].textContent !== t('Session', 'Sessão')) nav[0].textContent = t('Session', 'Sessão');
    const hs = headsetState();
    const text = `● ${modeLabel()}`;
    if (b.textContent !== text) b.textContent = text;
    b.dataset.state = hs.cls;
    b.title = hs.text;
  }

  function decorateMeasure() {
    const m = document.getElementById('main');
    if (!BC) return;
    if (BC.step === 3) {
      if (session.started && !m.querySelector('[data-mvp="bc"]')) renderBc();
      return;
    }
    const demo = m.querySelector('.check .demo');
    if (demo && !demo.dataset.mvp) { demo.dataset.mvp = '1'; demo.textContent = modeLabel(); }
    if (BC.step === 0) {
      const ring = m.querySelector('svg.signalRing');
      if (ring) {
        const div = document.createElement('div');
        div.className = 'mvpRing';
        div.id = 'mvpRing';
        ring.replaceWith(div);
        const p = div.nextElementSibling;
        if (p && p.tagName === 'P') { p.id = 'mvpRingText'; }
      }
      setHtml($('#mvpRing'), electrodeSvg(signal.state.quality, true));
      const p = $('#mvpRingText');
      if (p) {
        const q = signal.state.quality;
        const txt = `${headsetState().text}${q?.measured ? ` · ${t('average', 'média')} ${Math.round(q.mean)}/100` : ''}`;
        if (p.textContent !== txt) p.textContent = txt;
      }
      let info = $('#mvpBcInfo');
      if (!info) {
        const h1 = m.querySelector('.check h1');
        if (h1) { info = document.createElement('p'); info.id = 'mvpBcInfo'; info.className = 'note'; h1.after(info); }
      }
      if (info) {
        const txt = session.active ? `${t('Session', 'Sessão')} · ${session.participant} · ${t('the EEG is being recorded', 'o EEG está a ser gravado')}`
          : t('No session yet: start it in the setup screen (badge at the top).', 'Ainda sem sessão: começa-a no ecrã de preparação (etiqueta no topo).');
        if (info.textContent !== txt) info.textContent = txt;
      }
    } else {
      const sub = m.querySelector('.check p.subtle');
      if (sub && !sub.dataset.mvp) { sub.dataset.mvp = '1'; sub.textContent = `${t('Recording EEG', 'A gravar EEG')} · ${modeLabel()}`; }
    }
  }

  window.v84Footer();
  setInterval(refresh, 500);
  // Replace the prototype's example dashboard (rendered before this module loaded)
  // and reveal the page, hidden until now by the boot line in index.html.
  mvpSetup();
  document.getElementById('nrsBoot')?.remove();
  new MutationObserver(() => {
    if (S.view === 'measure') decorateMeasure();
    if (S.view === 'how' || S.view === 'selected') decorateIllustration();
    if (S.view === 'setup' && !document.querySelector('#main [data-mvp="setup"]')) mvpSetup();
  }).observe(document.getElementById('main'), { childList: true, subtree: true });
  refresh();
}

// ---------------------------------------------------------------- charts
// Same markup and classes as the prototype's v94 chart()/gauge() (L2662–2665),
// so the reports keep the designer's look.
function linePath(values, w = 600, h = 160) {
  return values.map((x, i) => (i ? 'L' : 'M') + (i / Math.max(1, values.length - 1) * w).toFixed(1) + ',' + (h - Math.max(0, Math.min(100, x)) / 100 * h).toFixed(1)).join(' ');
}

function chart(values, base, unit, label, splitIndex = null, xLabel = '', xEnd = '') {
  const split = splitIndex != null && values.length > 1 ? (splitIndex / (values.length - 1)) * 560 : null;
  return '<div class="chart"><svg viewBox="0 0 620 225" role="img" aria-label="' + esc(label) + '"><g transform="translate(35 10)">'
    + [0, 25, 50, 75, 100].map((x) => '<line x1="0" x2="560" y1="' + (160 - x * 1.6) + '" y2="' + (160 - x * 1.6) + '" stroke="#ffffff10"/><text x="-30" y="' + (164 - x * 1.6) + '">' + x + '</text>').join('')
    + (base ? '<path d="' + linePath(base, 560) + '" fill="none" stroke="#718697" stroke-width="2" stroke-dasharray="5 5"/>' : '')
    + (split != null ? '<line x1="' + split.toFixed(1) + '" x2="' + split.toFixed(1) + '" y1="0" y2="160" stroke="#9385df" stroke-dasharray="4 4"/>' : '')
    + '<path d="' + linePath(values, 560) + '" fill="none" stroke="#55e3cc" stroke-width="3"/>'
    + '<text y="195">0</text><text x="240" y="195">' + esc(xLabel) + '</text><text x="520" y="195">' + esc(xEnd) + '</text><text x="0" y="-1">' + esc(unit) + '</text></g></svg></div>';
}

function gauge(value, label) {
  return '<svg class="gauge" viewBox="0 0 260 200" role="img" aria-label="' + esc(label) + ' ' + value + '%"><path d="M35 155 A105 105 0 1 1 225 155" fill="none" stroke="#293e4c" stroke-width="9" stroke-linecap="round"/><path d="M35 155 A105 105 0 1 1 225 155" fill="none" stroke="#55e3cc" stroke-width="9" stroke-linecap="round" pathLength="100" stroke-dasharray="' + value + ' 100"/><text x="130" y="112" text-anchor="middle" font-size="51" font-weight="500">' + value + '<tspan font-size="18">%</tspan></text><text x="130" y="142" text-anchor="middle" font-size="11">' + esc(label) + '</text></svg>';
}

function downsample(values, max) {
  const filled = [];
  let last = null;
  for (const v of values) { if (v != null) last = v; filled.push(last); }
  const first = filled.find((v) => v != null) ?? 0;
  const xs = filled.map((v) => (v == null ? first : v));
  if (xs.length <= max) return xs;
  const k = xs.length / max;
  return Array.from({ length: max }, (_, i) => {
    const a = Math.floor(i * k), b = Math.max(a + 1, Math.floor((i + 1) * k));
    const seg = xs.slice(a, b);
    return seg.reduce((s, v) => s + v, 0) / seg.length;
  });
}

function injectCss() {
  if (document.getElementById('mvpCss')) return;
  const l = document.createElement('link');
  l.id = 'mvpCss';
  l.rel = 'stylesheet';
  l.href = new URL('../../css/mvp.css', import.meta.url).href;
  document.head.appendChild(l);
}
