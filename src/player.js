import { ref, set, onValue, update, get, remove, onDisconnect, serverTimestamp } from 'firebase/database';
import { db } from './firebase.js';
import { el, uid, renderTargetText, clearRoot } from './helpers.js';
import { NUM_ROUNDS, ROUND_TIME_MS, calcPoints } from './game-config.js';
import { renderPodium } from './podium.js';
import { renderBalloonGame } from './balloon-game.js';
import { renderRunnerGame } from './runner-game.js';

const BLOCKED_NAME_PATTERNS = [
  /rassist/i, /nazi/i, /hitler/i, /holocaust/i, /sexist/i, /sexuell/i, /porno/i, /\bsex\b/i,
  /hass\b/i, /gewalt/i, /mord/i, /töt/i, /drog/i, /kokain/i, /heroin/i,
  /hurensohn/i, /schwuchtel/i, /nigger/i, /neger/i, /fick/i, /fotze/i, /arsch/i, /wichser/i,
  /behindert/i, /spast/i, /mongo/i, /nutte/i, /\bhure\b/i, /schlamp/i,
  /penis/i, /vagina/i, /titten/i, /schwanz/i, /terror/i, /bombe/i, /anschlag/i,
  /suizid/i, /selbstmord/i, /scheiss/i, /kack/i, /piss/i,
  /missgeburt/i, /bastard/i, /opfer/i, /schwul/i, /lesbe/i, /transe/i,
];
function isNameBlocked(name) {
  const textOnly = name.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim();
  if (textOnly.length === 0) return false;
  return BLOCKED_NAME_PATTERNS.some(p => p.test(textOnly));
}

export function renderJoin(root, prefilledRoom) {
  const errEl = el('div', { class: 'err' });
  const roomInput = el('input', { type: 'text', class: 'room-input', placeholder: 'RAUMCODE', maxlength: '4', value: prefilledRoom || '' });
  const nameInput = el('input', { type: 'text', placeholder: 'Dein Spitzname', maxlength: '14' });
  const btn = el('button', { onclick: tryJoin }, 'Eintreten →');

  async function tryJoin() {
    errEl.textContent = '';
    const room = roomInput.value.trim().toUpperCase();
    const name = nameInput.value.trim();
    if (!room || room.length !== 4) { errEl.textContent = 'Raumcode hat 4 Buchstaben/Zahlen.'; return; }
    if (!name) { errEl.textContent = 'Bitte einen Spitznamen eingeben.'; return; }
    if (isNameBlocked(name)) { errEl.textContent = '⚠ Wähle einen angemessenen Namen.'; return; }
    btn.disabled = true;
    try {
      const snap = await get(ref(db, `rooms/${room}/state`));
      if (!snap.exists()) { errEl.textContent = 'Raum nicht gefunden.'; btn.disabled = false; return; }
      const state = snap.val() || {};
      // Erlaube Beitritte in Lobby und Leaderboard (vorbereitung für nächste Runde)
      // Aber NICHT während "playing" oder "podium"
      const allowedPhases = ['lobby', 'leaderboard'];
      if (state.phase && !allowedPhases.includes(state.phase)) {
        errEl.textContent = "Spiel läuft gerade. Warte bis die Runde vorbei ist und versuche es nochmal!";
        btn.disabled = false;
        return;
      }
      const playerId = uid();
      await set(ref(db, `rooms/${room}/players/${playerId}`), { name, score: 0, lastDelta: 0, progress: 0, status: 'idle', joinedAt: serverTimestamp() });
      onDisconnect(ref(db, `rooms/${room}/players/${playerId}/online`)).set(false);
      await set(ref(db, `rooms/${room}/players/${playerId}/online`), true);
      enterPlayerLoop(root, room, playerId, name);
    } catch (e) { console.error(e); errEl.textContent = 'Fehler beim Beitreten.'; btn.disabled = false; }
  }

  clearRoot(root);
  root.appendChild(el('div', { class: 'join' }, [
    el('h1', {}, [el('span', {}, 'Type'), 'Battle']),
    prefilledRoom ? el('div', { class: 'room-pill' }, ['Raum: ', el('strong', {}, prefilledRoom)]) : null,
    el('div', { class: 'input-group' }, [prefilledRoom ? null : roomInput, nameInput, btn, errEl])
  ]));
  setTimeout(() => (prefilledRoom ? nameInput : roomInput).focus(), 100);
}

function enterPlayerLoop(root, roomCode, playerId, name) {
  let state = { phase: 'lobby', round: 0 };
  let myPlayer = { name, score: 0 };
  let allPlayers = {};
  let lastPhaseRendered = null;
  let kicked = false;

  onValue(ref(db, `rooms/${roomCode}/state`), snap => { if (kicked) return; state = snap.val() || { phase: 'lobby', round: 0 }; rerender(); });
  onValue(ref(db, `rooms/${roomCode}/players`), snap => {
    if (kicked) return;
    allPlayers = snap.val() || {};
    myPlayer = allPlayers[playerId] || myPlayer;
    if (!allPlayers[playerId] && !kicked) {
      kicked = true; clearRoot(root);
      root.appendChild(el('div', { class: 'waiting' }, [
        el('div', { style: 'font-size:2.5rem;margin-bottom:1rem;' }, '🚫'),
        el('div', { class: 'name', style: 'color:var(--accent-2);' }, 'Entfernt'),
        el('div', { class: 'msg' }, 'Du wurdest aus dem Spiel entfernt.'),
        el('button', { class: 'next-btn', style: 'margin-top:2rem;', onclick: () => renderJoin(root, roomCode) }, 'Erneut beitreten')
      ]));
      return;
    }
    rerender();
  });

  function rerender() {
    const key = `${state.phase}-${state.round}`;
    if (key === lastPhaseRendered) return;
    lastPhaseRendered = key;
    if (state.phase === 'lobby') renderPlayerWaiting(root, name);
    else if (state.phase === 'playing') {
      if (state.mode === 'balloon') renderBalloonGame(root, roomCode, playerId, state);
      else if (state.mode === 'runner') renderRunnerGame(root, roomCode, playerId, state);
      else renderPlayerGame(root, roomCode, playerId, name, state);
    }
    else if (state.phase === 'leaderboard') renderPlayerLeaderboard(root, allPlayers, playerId, state);
    else if (state.phase === 'podium') renderPodium(root, allPlayers, false, null, playerId);
  }
  rerender();
}

function renderPlayerWaiting(root, name) {
  clearRoot(root);
  root.appendChild(el('div', { class: 'waiting' }, [
    el('div', { class: 'you' }, 'Du bist'), el('div', { class: 'name' }, name),
    el('div', { class: 'msg' }, [el('span', { class: 'pulse-dot' }), 'Warte, bis die Lehrkraft das Spiel startet…'])
  ]));
}

function renderPlayerGame(root, roomCode, playerId, name, state) {
  const target = state.sentence || '';
  const startedAt = state.startedAt || Date.now();
  const maxMs = state.durationMs || ROUND_TIME_MS;
  const totalRounds = state.totalRounds || NUM_ROUNDS;
  let typed = '', firstKeyAt = null, finished = false;

  const targetEl = el('div', { class: 'target-text' }, renderTargetText(target, typed));
  const textarea = el('textarea', { rows: '2', placeholder: 'Hier tippen…', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const progressFill = el('div', { class: 'progress-bar-fill' });
  const timerEl = el('div', { class: 'timer' }, '30s');
  const wpmEl = el('div', { class: 'v' }, '—');
  const accEl = el('div', { class: 'v' }, '—');
  const errCntEl = el('div', { class: 'v' }, '0');
  const stage = el('div', {}); stage.appendChild(targetEl);
  const inputArea = el('div', { class: 'input-area' }, [textarea, el('div', { class: 'progress-bar' }, progressFill)]);

  function recompute() {
    targetEl.replaceChildren(renderTargetText(target, typed));
    const pct = Math.min(1, typed.length / target.length);
    progressFill.style.width = (pct * 100) + '%';
    let correct = 0, errors = 0;
    for (let i = 0; i < typed.length; i++) { if (i < target.length && typed[i] === target[i]) correct++; else errors++; }
    const total = Math.max(typed.length, 1);
    accEl.textContent = Math.round((correct / total) * 100) + '%';
    const elapsed = firstKeyAt ? (Date.now() - firstKeyAt) / 1000 / 60 : 0;
    wpmEl.textContent = elapsed > 0 ? Math.round((correct / 5) / elapsed) : '—';
    errCntEl.textContent = errors;
    if (!recompute._last || Date.now() - recompute._last > 250) { recompute._last = Date.now(); update(ref(db, `rooms/${roomCode}/players/${playerId}`), { progress: pct }); }
    if (typed === target && !finished) finishRound();
  }

  textarea.addEventListener('input', () => { if (finished) return; if (!firstKeyAt) firstKeyAt = Date.now(); typed = textarea.value; if (typed.length > target.length) typed = typed.substring(0, target.length); textarea.value = typed; recompute(); });

  async function finishRound() {
    finished = true; textarea.disabled = true;
    const usedMs = Date.now() - startedAt;
    const typingMs = firstKeyAt ? (Date.now() - firstKeyAt) : usedMs;
    let correct = 0, errors = 0;
    for (let i = 0; i < typed.length; i++) { if (i < target.length && typed[i] === target[i]) correct++; else errors++; }
    const totalChars = target.length;
    const points = calcPoints({ correct, total: totalChars, errors, usedMs, maxMs });
    const cur = (await get(ref(db, `rooms/${roomCode}/players/${playerId}`))).val() || { score: 0 };
    await update(ref(db, `rooms/${roomCode}/players/${playerId}`), {
      score: (cur.score||0)+points, lastDelta: points, progress: correct/totalChars, status: 'done', finishedAt: Date.now(),
      totalCorrect: (cur.totalCorrect||0)+correct, totalChars: (cur.totalChars||0)+totalChars,
      totalErrors: (cur.totalErrors||0)+errors, totalTimeMs: (cur.totalTimeMs||0)+typingMs, roundsPlayed: (cur.roundsPlayed||0)+1
    });
    stage.replaceChildren(el('div', { class: 'done-msg' }, [
      el('h2', {}, 'Fertig!'), el('div', { class: 'points' }, '+' + points),
      el('div', { style: 'color:var(--text-dim);font-family:var(--font-mono);margin-top:1rem' }, `${correct}/${totalChars} richtig · ${errors} Fehler`)
    ]));
  }

  function tick() {
    const remaining = Math.max(0, (startedAt + maxMs) - Date.now());
    timerEl.textContent = Math.ceil(remaining / 1000) + 's';
    timerEl.classList.toggle('warn', remaining < 5000);
    if (remaining <= 0 && !finished) { finishRound(); return; }
    if (!finished) requestAnimationFrame(tick);
  }
  tick();

  clearRoot(root);
  root.appendChild(el('div', { class: 'game' }, [
    el('div', { class: 'game-header' }, [
      el('div', { class: 'timer-wrap' }, [timerEl]),
      el('div', { class: 'game-header-top' }, [
        el('div', {}, [el('span', { class: 'lesson-tag' }, state.lesson || ''), el('div', { class: 'round-info', style: 'margin-top:0.5rem' }, ['Runde ', el('strong', {}, `${state.round}`), ` / ${totalRounds}`])])
      ])
    ]),
    stage, inputArea,
    el('div', { class: 'live-stats' }, [
      el('div', { class: 'stat' }, [wpmEl, el('div', { class: 'l' }, 'WPM')]),
      el('div', { class: 'stat' }, [accEl, el('div', { class: 'l' }, 'Genau')]),
      el('div', { class: 'stat' }, [errCntEl, el('div', { class: 'l' }, 'Fehler')])
    ])
  ]));
  setTimeout(() => textarea.focus(), 100);
}

function renderPlayerLeaderboard(root, allPlayers, myId, state) {
  const totalRounds = state.totalRounds || NUM_ROUNDS;
  const playerList = Object.entries(allPlayers).filter(([, p]) => p && p.online !== false).sort((a, b) => (b[1].score||0) - (a[1].score||0));
  const isLast = state.round >= totalRounds;
  const list = el('div', {});
  playerList.forEach(([id, p], i) => {
    const rank = i + 1; const cls = ['lb-row'];
    if (id === myId) cls.push('me'); else if (rank === 1) cls.push('r1'); else if (rank === 2) cls.push('r2'); else if (rank === 3) cls.push('r3');
    list.appendChild(el('div', { class: cls.join(' '), style: `animation-delay:${i*0.06}s` }, [
      el('div', { class: 'rank' }, '#' + rank), el('div', { class: 'name' }, p.name + (id === myId ? ' (du)' : '')),
      el('div', { class: 'delta' }, p.lastDelta > 0 ? `+${p.lastDelta}` : ''), el('div', { class: 'pts' }, String(p.score || 0))
    ]));
  });
  clearRoot(root);
  root.appendChild(el('div', { class: 'leaderboard' }, [
    el('h1', {}, isLast ? 'Endstand' : 'Zwischenstand'),
    el('div', { class: 'sub' }, `Nach Runde ${state.round} / ${totalRounds}`), list,
    el('div', { style: 'text-align:center;color:var(--text-dim);margin-top:2rem;font-family:var(--font-mono);font-size:0.9rem' }, isLast ? '… gleich kommt das Podest' : 'Warte auf die nächste Runde…')
  ]));
}
