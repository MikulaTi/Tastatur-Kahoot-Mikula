import {
  ref, set, onValue, update, get, remove, onDisconnect, serverTimestamp
} from 'firebase/database';
import { db, SETUP_OK } from './firebase.js';
import { el, genRoomCode, colorFor, makeQR, renderTargetText, clearRoot } from './helpers.js';
import { ROUND_TIME_MS, NUM_ROUNDS } from './game-config.js';
import { renderPodium, showSetupWarning } from './podium.js';
import { generateSentences, generateWords } from './generate-sentences.js';

let _hostTickInterval = null;
let _endingRound = false;
let _gameRounds = [];

function stopHostTick() {
  if (_hostTickInterval) { clearInterval(_hostTickInterval); _hostTickInterval = null; }
}

export async function startAsHost(root) {
  if (!SETUP_OK) { alert('Firebase muss zuerst konfiguriert werden.'); return; }
  let code, exists = true;
  while (exists) { code = genRoomCode(); const snap = await get(ref(db, `rooms/${code}/state`)); exists = snap.exists(); }
  await set(ref(db, `rooms/${code}`), { state: { phase: 'lobby', round: 0, createdAt: serverTimestamp() }, players: null });
  onDisconnect(ref(db, `rooms/${code}`)).remove();
  enterHostLoop(root, code);
}

function enterHostLoop(root, roomCode) {
  let players = {};
  let state = { phase: 'lobby', round: 0 };
  let lastRenderedKey = null;
  const lobbyState = { topic: '', numRounds: 10, mode: 'random', tempo: 1.0 };
  const joinUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
  window._currentJoinUrl = joinUrl;

  window._forceEndGame = async () => {
    if (!confirm('Spiel wirklich vorzeitig beenden?')) return;
    await update(ref(db, `rooms/${roomCode}/state`), { phase: 'podium' });
  };

  onValue(ref(db, `rooms/${roomCode}/players`), snap => {
    players = snap.val() || {};
    window._latestPlayers = players;
    if (state.phase === 'playing') return;
    rerender();
  });
  onValue(ref(db, `rooms/${roomCode}/state`), snap => {
    state = snap.val() || { phase: 'lobby', round: 0 };
    rerender();
  });

  function rerender() {
    const key = state.phase + '-' + state.round;
    if (state.phase === 'playing' && key === lastRenderedKey) return;
    lastRenderedKey = key;
    const isInGame = state.phase === 'playing' || state.phase === 'leaderboard';
    if (window._footerEndBtn) window._footerEndBtn.style.display = isInGame ? 'inline-block' : 'none';
    if (window._footerQR) {
      if (isInGame) {
        window._footerQR.innerHTML = '';
        const qrSize = 50;
        const qrImg = document.createElement('img');
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=${qrSize}x${qrSize}&data=${encodeURIComponent(joinUrl)}&margin=4`;
        qrImg.alt = 'QR'; qrImg.width = qrSize; qrImg.height = qrSize; qrImg.style.borderRadius = '4px';
        window._footerQR.appendChild(qrImg);
      } else { window._footerQR.innerHTML = ''; }
    }
    if (state.phase === 'lobby') renderHostLobby(root, roomCode, players, lobbyState, joinUrl);
    else if (state.phase === 'playing') renderHostGame(root, roomCode, players, state);
    else if (state.phase === 'leaderboard') renderHostLeaderboard(root, roomCode, players, state);
    else if (state.phase === 'podium') renderHostPodium(root, roomCode, players);
  }
  rerender();
}

async function kickPlayer(roomCode, playerId, playerName) {
  if (!confirm(`"${playerName}" wirklich entfernen?`)) return;
  try { await remove(ref(db, `rooms/${roomCode}/players/${playerId}`)); } catch (e) { console.error('Kick fehlgeschlagen:', e); }
}

function renderHostLobby(root, roomCode, players, lobbyState, joinUrl) {
  const playerList = Object.entries(players).filter(([, p]) => p && p.online !== false);

  const topicInput = el('input', {
    type: 'text', placeholder: 'z.B. Mittelalter, Fussball, Weltall …', maxlength: '80', value: lobbyState.topic,
    style: 'width:100%;background:var(--surface-2);border:2px solid var(--border);border-radius:10px;padding:0.85rem 1rem;font-size:1rem;color:var(--text);font-family:var(--font-body);outline:none;margin-top:0.5rem;transition:border-color 0.15s;'
  });
  topicInput.addEventListener('focus', () => { topicInput.style.borderColor = 'var(--accent)'; });
  topicInput.addEventListener('blur', () => { topicInput.style.borderColor = 'var(--border)'; });
  topicInput.addEventListener('input', () => { lobbyState.topic = topicInput.value; });

  // Modus-Auswahl
  const modeOptions = [
    { value: 'random',  label: '🎲 Zufällig — alle Modi zufällig gemischt' },
    { value: 'classic', label: '⌨️ Klassik — Satz abschreiben' },
    { value: 'balloon', label: '🎈 Ballon-Pop — Wörter platzen lassen' },
    { value: 'runner',  label: '🏃 Tipp-Lauf — Figur rennt pro Wort vorwärts' },
  ];
  const modeSelect = el('select', {
    style: 'width:100%;background:var(--surface-2);border:2px solid var(--border);border-radius:10px;padding:0.75rem 1rem;font-size:0.95rem;color:var(--text);font-family:var(--font-body);outline:none;margin-top:0.5rem;cursor:pointer;'
  });
  modeOptions.forEach(opt => { const o = el('option', { value: opt.value }, opt.label); if (opt.value === lobbyState.mode) o.selected = true; modeSelect.appendChild(o); });
  modeSelect.addEventListener('change', () => { lobbyState.mode = modeSelect.value; });

  // Anzahl Runden
  const rangeVal = el('div', { class: 'range-val' }, String(lobbyState.numRounds));
  const rangeInput = el('input', { type: 'range', min: '5', max: '20', value: String(lobbyState.numRounds), step: '1' });
  rangeInput.addEventListener('input', () => { rangeVal.textContent = rangeInput.value; lobbyState.numRounds = parseInt(rangeInput.value); timeHint.textContent = `≈ ${rangeInput.value} Minuten Spielzeit (ca. 1 Min. pro Runde)`; });
  const timeHint = el('div', { style: 'font-size:0.78rem;color:var(--text-dim);margin-top:0.4rem;font-style:italic;' }, `≈ ${lobbyState.numRounds} Minuten Spielzeit (ca. 1 Min. pro Runde)`);

  // Tempo-Slider (NUR für Ballon-Pop!)
  // Tempo-Labels: Key = gerundeter Wert × 100 (Integer, kein Float-Problem!)
  const tempoLabelsMap = {
    50:  { label: 'Snail 🐢', hint: 'Sehr langsam — ~14-20s Sichtbarkeit pro Ballon' },
    75:  { label: 'Basic', hint: 'Langsam — ~9-13s Sichtbarkeit pro Ballon' },
    100: { label: 'Standard', hint: 'Normal — ~7-10s Sichtbarkeit pro Ballon (empfohlen)' },
    125: { label: 'Medium+', hint: 'Etwas schneller — ~6-8s Sichtbarkeit pro Ballon' },
    150: { label: 'Hard', hint: 'Schnell — ~5-7s Sichtbarkeit pro Ballon' },
    175: { label: 'Hard+', hint: 'Noch schneller — ~4-6s Sichtbarkeit pro Ballon' },
    200: { label: 'Pro 🐇', hint: 'Sehr schnell — ~4-5s Sichtbarkeit + 2x Doppelballone' }
  };
  function getTempoInfo(val) {
    const key = Math.round(parseFloat(val) * 100);
    return tempoLabelsMap[key] || { label: key / 100 + 'x', hint: '' };
  }
  const tempoVal = el('div', { class: 'range-val', style: 'width: 6.5rem; text-align: center; font-size: 0.9rem; font-weight: 700; flex-shrink: 0;' }, getTempoInfo('1.0').label);
  const tempoHint = el('div', { style: 'font-size:0.78rem;color:var(--text-dim);margin-top:0.4rem;font-style:italic;min-height:1.2em;' }, getTempoInfo('1.0').hint);
  const tempoInput = el('input', { type: 'range', min: '0.5', max: '2.0', value: '1.0', step: '0.25' });
  tempoInput.addEventListener('input', () => {
    const tempo = parseFloat(tempoInput.value);
    lobbyState.tempo = tempo;
    const info = getTempoInfo(tempo);
    tempoVal.textContent = info.label;
    tempoHint.textContent = info.hint;
  });
  // Initialize
  lobbyState.tempo = 1.0;  // Mitte = Standard

  const labelStyle = 'font-family:var(--font-mono);font-size:0.8rem;text-transform:uppercase;letter-spacing:0.15em;color:var(--text-dim);display:block;';

  const statusMsg = el('div', { style: 'min-height:1.4em;margin-top:0.5rem;font-size:0.85rem;text-align:center;' });
  const startBtn = el('button', {
    class: 'start-game-btn',
    onclick: () => handleStartGame(root, roomCode, topicInput.value.trim(), parseInt(rangeInput.value), modeSelect.value, parseFloat(tempoInput.value), startBtn, statusMsg)
  }, playerList.length === 0 ? 'Warte auf Spieler…' : `Spiel starten (${playerList.length} dabei)`);
  if (playerList.length === 0) startBtn.disabled = true;

  const playerGrid = el('div', { class: 'player-grid' });
  playerList.forEach(([id, p], i) => {
    const kickBtn = el('button', { class: 'kick-btn', onclick: (e) => { e.stopPropagation(); kickPlayer(roomCode, id, p.name); } }, '✕');
    playerGrid.appendChild(el('div', { class: 'player-chip', style: `border-left-color: var(--${colorFor(i)})` }, [
      el('span', { class: 'chip-name' }, p.name), kickBtn
    ]));
  });

  clearRoot(root);
  if (!SETUP_OK) root.appendChild(showSetupWarning());
  root.appendChild(el('div', { class: 'lobby' }, [
    el('div', { class: 'lobby-info' }, [
      el('div', { class: 'room-label' }, 'Raumcode'),
      el('div', { class: 'room-code' }, roomCode),
      el('div', { class: 'qr-wrap', style: 'cursor:pointer;', onclick: () => { if (window._showQROverlay) window._showQROverlay(joinUrl); } }, makeQR(joinUrl)),
      el('div', { class: 'qr-hint' }, ['oder: ', joinUrl.replace(/^https?:\/\//, '')])
    ]),
    el('div', { class: 'lobby-players' }, [
      el('h2', {}, ['Spieler*innen ', el('span', { class: 'player-count' }, String(playerList.length))]),
      playerList.length === 0 ? el('div', { style: 'color:var(--text-dim);padding:2rem;text-align:center;' }, 'QR-Code scannen oder Raumcode eingeben →') : playerGrid,
      el('div', { style: 'margin-top:1.2rem;width:100%;' }, [
        el('label', { style: labelStyle }, 'Spielmodus'),
        modeSelect,
        el('label', { style: labelStyle + 'margin-top:1.2rem;' }, 'Thema (optional)'),
        topicInput,
        el('div', { style: 'font-size:0.78rem;color:var(--text-dim);margin-top:0.4rem;font-style:italic;' }, 'Leer lassen = zufällige Redewendungen und Witze. Mit Thema generiert KI passende Inhalte.'),
        el('label', { style: labelStyle + 'margin-top:1.2rem;' }, 'Anzahl Runden'),
        el('div', { class: 'range-wrap' }, [
          el('span', { style: 'font-family:var(--font-mono);font-size:0.75rem;color:var(--text-dim)' }, '5'), rangeInput,
          el('span', { style: 'font-family:var(--font-mono);font-size:0.75rem;color:var(--text-dim)' }, '20'), rangeVal
        ]),
        timeHint,
        el('label', { style: labelStyle + 'margin-top:1.2rem;' }, '🎈 Tempo (nur Ballon-Pop)'),
        el('div', { class: 'range-wrap' }, [
          el('span', { style: 'font-family:var(--font-mono);font-size:0.75rem;color:var(--text-dim)' }, '🐢'), tempoInput,
          el('span', { style: 'font-family:var(--font-mono);font-size:0.75rem;color:var(--text-dim)' }, '🐇'), tempoVal
        ]),
        tempoHint,
      ]),
      startBtn,
      statusMsg
    ])
  ]));
}

async function handleStartGame(root, roomCode, topic, numRounds, selectedMode, tempo, btn, statusEl) {
  btn.disabled = true;
  statusEl.innerHTML = '';
  statusEl.style.color = 'var(--accent)';
  statusEl.appendChild(el('span', { class: 'pulse-dot' }));
  statusEl.appendChild(document.createTextNode(topic ? ` KI bereitet ${numRounds} Runden vor…` : ` ${numRounds} Runden werden vorbereitet…`));

  try {
    const ALL_MODES = ['classic', 'balloon', 'runner'];
    const roundModes = [];
    for (let i = 0; i < numRounds; i++) {
      if (selectedMode === 'random') {
        if (i === 0) { roundModes.push('classic'); }
        else { let pick; do { pick = ALL_MODES[Math.floor(Math.random() * ALL_MODES.length)]; } while (i >= 2 && roundModes[i-1] === pick && roundModes[i-2] === pick); roundModes.push(pick); }
      } else { roundModes.push(selectedMode); }
    }

    const classicIndices = roundModes.map((m, i) => m === 'classic' ? i : -1).filter(i => i >= 0);
    const wordIndices = roundModes.map((m, i) => m !== 'classic' ? i : -1).filter(i => i >= 0);

    const numClassic = classicIndices.length;
    const sentenceResult = numClassic > 0 ? await generateSentences(topic, numClassic) : { sentences: [], blocked: false };
    if (sentenceResult.blocked) {
      statusEl.style.color = 'var(--bad)';
      statusEl.textContent = '⚠ Dieses Thema ist nicht erlaubt. Es werden zufällige Inhalte verwendet.';
      await new Promise(r => setTimeout(r, 2000));
    }

    const wordRoundSets = [];
    for (let i = 0; i < wordIndices.length; i++) {
      const words = await generateWords(topic, 12);
      wordRoundSets.push(words);
    }

    _gameRounds = [];
    let classicIdx = 0, wordIdx = 0;
    for (let i = 0; i < numRounds; i++) {
      const mode = roundModes[i];
      if (mode === 'classic' && classicIdx < sentenceResult.sentences.length) {
        _gameRounds.push({ mode: 'classic', ...sentenceResult.sentences[classicIdx] });
        classicIdx++;
      } else if (wordIdx < wordRoundSets.length) {
        const modeLabels = { balloon: '🎈 Ballon-Pop', runner: '🏃 Tipp-Lauf' };
        _gameRounds.push({ mode: mode === 'classic' ? 'balloon' : mode, lesson: modeLabels[mode === 'classic' ? 'balloon' : mode], words: wordRoundSets[wordIdx] });
        wordIdx++;
      }
    }

    if (_gameRounds.length < numRounds) { statusEl.style.color = 'var(--bad)'; statusEl.textContent = 'Fehler. Bitte nochmal versuchen.'; btn.disabled = false; return; }

    // Tempo-Faktor speichern für die Runden
    _gameRounds._tempoFactor = tempo;

    statusEl.style.color = 'var(--good)'; statusEl.textContent = '✓ Runden bereit — Spiel startet!';
    await new Promise(r => setTimeout(r, 500));
    await startNextRound(roomCode, 1);
  } catch (e) {
    console.error('Fehler:', e); statusEl.style.color = 'var(--bad)'; statusEl.textContent = 'Fehler — bitte nochmal versuchen.'; btn.disabled = false;
  }
}

async function startNextRound(roomCode, roundNum) {
  if (roundNum > _gameRounds.length) { await update(ref(db, `rooms/${roomCode}/state`), { phase: 'podium' }); return; }
  const round = _gameRounds[roundNum - 1];
  const tempo = _gameRounds._tempoFactor || 1.0;
  const playersSnap = await get(ref(db, `rooms/${roomCode}/players`));
  const players = playersSnap.val() || {};
  const updates = {};
  Object.keys(players).forEach(pid => {
    updates[`players/${pid}/progress`] = 0; updates[`players/${pid}/status`] = 'typing';
    updates[`players/${pid}/lastDelta`] = 0; updates[`players/${pid}/finishedAt`] = null;
  });
  const stateUpdate = {
    phase: 'playing', round: roundNum, mode: round.mode, lesson: round.lesson,
    totalRounds: _gameRounds.length, startedAt: Date.now(),
    durationMs: round.mode === 'classic' ? ROUND_TIME_MS : round.mode === 'runner' ? 40000 : 50000,
    balloonTempoFactor: round.mode === 'balloon' ? tempo : 1.0,
  };
  if (round.mode === 'classic') { stateUpdate.sentence = round.text; stateUpdate.words = null; }
  else { stateUpdate.sentence = null; stateUpdate.words = round.words; }
  updates['state'] = stateUpdate;
  await update(ref(db, `rooms/${roomCode}`), updates);
}

function renderHostGame(root, roomCode, players, state) {
  if (state.phase !== 'playing') { stopHostTick(); return; }
  const totalRounds = state.totalRounds || _gameRounds.length || NUM_ROUNDS;
  const playerList = Object.entries(players).filter(([, p]) => p && p.online !== false).sort((a, b) => (b[1].score||0) - (a[1].score||0));

  clearRoot(root);
  if (!SETUP_OK) root.appendChild(showSetupWarning());
  const timerEl = el('div', { class: 'timer' }, '–');
  const progressList = el('div', { class: 'progress-list' }, [el('h3', {}, 'Live-Fortschritt')]);
  const rowRefs = [];
  playerList.forEach(([id, p], i) => {
    const fill = el('div', { class: 'bar-fill', style: `width:0%;background:var(--${colorFor(i)})` });
    const pctEl = el('div', { class: 'pct' }, '0%');
    const row = el('div', { class: 'progress-row' }, [
      el('div', { class: 'dot', style: `background:var(--${colorFor(i)})` }),
      el('div', { class: 'name' }, p.name), pctEl,
      el('div', { class: 'bar' }, [fill])
    ]);
    progressList.appendChild(row);
    rowRefs.push({ id, row, fill, pctEl });
  });
  const skipBtn = el('button', { class: 'next-btn', style: 'margin:1rem auto 0;display:block;', onclick: () => { stopHostTick(); forceEndRound(roomCode, state.round); } }, '⏭  Runde beenden');

  root.appendChild(el('div', { class: 'host-game' }, [
    el('div', { class: 'game-header' }, [
      el('div', { class: 'timer-wrap' }, [timerEl]),
      el('div', { class: 'game-header-top' }, [
        el('div', {}, [
          el('span', { class: 'lesson-tag' }, state.lesson || ''),
          el('div', { class: 'round-info', style: 'margin-top:0.5rem' }, ['Runde ', el('strong', {}, `${state.round}`), ` / ${totalRounds}`])
        ])
      ])
    ]),
    state.mode === 'classic'
      ? el('div', { class: 'target-text' }, renderTargetText(state.sentence || '', ''))
      : el('div', { class: 'target-text', style: 'text-align:center;' }, [
          el('span', { style: 'font-size:2rem;' }, state.mode === 'balloon' ? '🎈' : '🏃'),
          el('div', { style: 'margin-top:0.5rem;color:var(--text-dim);' },
            state.mode === 'balloon' ? `${(state.words||[]).length} Wörter platzen lassen!` : `${(state.words||[]).length} Wörter — renn ins Ziel!`)
        ]),
    progressList, skipBtn
  ]));

  function tick() {
    const remaining = Math.max(0, (state.durationMs || ROUND_TIME_MS) - (Date.now() - (state.startedAt || Date.now())));
    timerEl.textContent = Math.ceil(remaining / 1000) + 's';
    timerEl.classList.toggle('warn', remaining < 5000);
    rowRefs.forEach(r => {
      const p = (window._latestPlayers || players)[r.id]; if (!p) return;
      const pct = Math.round((p.progress || 0) * 100);
      r.fill.style.width = pct + '%'; r.pctEl.textContent = pct + '%';
      r.row.classList.toggle('done', p.status === 'done');
    });
    const livePlayers = window._latestPlayers || players;
    const liveArr = Object.entries(livePlayers).filter(([, p]) => p && p.online !== false);
    const allDone = liveArr.length > 0 && liveArr.every(([, p]) => p.status === 'done');
    if ((remaining <= 0 || allDone) && !_endingRound) { _endingRound = true; stopHostTick(); setTimeout(() => forceEndRound(roomCode, state.round), 600); }
  }
  stopHostTick(); _endingRound = false; tick();
  _hostTickInterval = setInterval(tick, 250);
}

async function forceEndRound(roomCode, roundNum) {
  try {
    const s = (await get(ref(db, `rooms/${roomCode}/state`))).val();
    if (!s || s.round !== roundNum || s.phase !== 'playing') { _endingRound = false; return; }
    await update(ref(db, `rooms/${roomCode}/state`), { phase: 'leaderboard' });
    _endingRound = false;
  } catch (e) { console.error('forceEndRound:', e); _endingRound = false; }
}

function renderHostLeaderboard(root, roomCode, players, state) {
  const totalRounds = state.totalRounds || _gameRounds.length || NUM_ROUNDS;
  const playerList = Object.entries(players).filter(([, p]) => p && p.online !== false).sort((a, b) => (b[1].score||0) - (a[1].score||0));
  const isLast = state.round >= totalRounds;
  const list = el('div', {});
  playerList.forEach(([, p], i) => {
    const rank = i + 1; const cls = ['lb-row'];
    if (rank === 1) cls.push('r1'); else if (rank === 2) cls.push('r2'); else if (rank === 3) cls.push('r3');
    list.appendChild(el('div', { class: cls.join(' '), style: `animation-delay:${i*0.08}s` }, [
      el('div', { class: 'rank' }, '#' + rank), el('div', { class: 'name' }, p.name),
      el('div', { class: 'delta' }, p.lastDelta > 0 ? `+${p.lastDelta}` : ''),
      el('div', { class: 'pts' }, String(p.score || 0))
    ]));
  });
  clearRoot(root);
  if (!SETUP_OK) root.appendChild(showSetupWarning());
  root.appendChild(el('div', { class: 'leaderboard' }, [
    el('h1', {}, isLast ? 'Endstand' : 'Zwischenstand'),
    el('div', { class: 'sub' }, `Nach Runde ${state.round} / ${totalRounds}`),
    list,
    el('button', { class: 'next-btn', onclick: () => isLast ? update(ref(db, `rooms/${roomCode}/state`), { phase: 'podium' }) : startNextRound(roomCode, state.round + 1) },
      isLast ? '🏆 Zum Podest' : `Weiter → Runde ${state.round + 1}`)
  ]));
}

function renderHostPodium(root, roomCode, players) {
  renderPodium(root, players, true, () => restartHostGame(roomCode));
}

async function restartHostGame(roomCode) {
  const players = (await get(ref(db, `rooms/${roomCode}/players`))).val() || {};
  const updates = {};
  Object.keys(players).forEach(pid => {
    updates[`players/${pid}/score`] = 0; updates[`players/${pid}/lastDelta`] = 0;
    updates[`players/${pid}/progress`] = 0; updates[`players/${pid}/status`] = 'idle';
    updates[`players/${pid}/totalCorrect`] = 0; updates[`players/${pid}/totalChars`] = 0;
    updates[`players/${pid}/totalErrors`] = 0; updates[`players/${pid}/totalTimeMs`] = 0;
    updates[`players/${pid}/roundsPlayed`] = 0;
  });
  updates['state'] = { phase: 'lobby', round: 0 };
  _gameRounds = [];
  await update(ref(db, `rooms/${roomCode}`), updates);
}
