// ═══════════════════════════════════════════════════════════════════
// BALLON-POP MINISPIEL
// - 12 Ballone pro Runde
// - Zeitbasiert (geräteunabhängig)
// - Standard: 7-10s Sichtbarkeit, variiert pro Ballon
// - 1-2x zwei Ballone gleichzeitig (bei höheren Levels mehr)
// ═══════════════════════════════════════════════════════════════════

import { ref, update, get } from 'firebase/database';
import { db } from './firebase.js';
import { el, clearRoot } from './helpers.js';
import { calcPoints, ROUND_TIME_MS, NUM_ROUNDS } from './game-config.js';

const BALLOON_COLORS = [
  '#7a1530', '#c4243b', '#2d8a4e', '#2a7ab5',
  '#8b5ea7', '#c97a2e', '#b84d6f', '#2a8a7a',
  '#3d7a6e', '#a0522d', '#6a5acd', '#c0392b'
];

export function renderBalloonGame(root, roomCode, playerId, state) {
  const words = state.words || [];
  const startedAt = state.startedAt || Date.now();
  const maxMs = state.durationMs || ROUND_TIME_MS;
  const totalRounds = state.totalRounds || NUM_ROUNDS;
  const tempoFactor = state.balloonTempoFactor !== undefined ? state.balloonTempoFactor : 1.0;

  let wordsHit = 0;
  let wordsMissed = 0;
  let totalCorrectChars = 0;
  let firstKeyAt = null;
  let finished = false;
  let animFrameId = null;

  // ─── BALLON-GENERIERUNG MIT VARIABLEM TIMING ───
  // Standard (1.0x): Basis-Sichtbarkeit 7-10s, variiert pro Ballon
  // Tempo-Faktor skaliert die Sichtbarkeit herunter
  const BASE_MIN_SECS = 7;   // Schnellster Ballon bei Standard
  const BASE_MAX_SECS = 10;  // Langsamster Ballon bei Standard

  // Bestimme Anzahl paralleler Paare je nach Tempo
  // Standard: 1-2 Paare, Pro: 2 Paare
  const numPairs = tempoFactor >= 2.0 ? 2 : (tempoFactor >= 1.0 ? 1 + Math.floor(Math.random() * 2) : Math.random() < 0.3 ? 1 : 0);

  // Parallele Indizes bestimmen (welche Ballone gleichzeitig fliegen)
  const parallelSets = new Set();
  if (numPairs > 0) {
    // Wähle zufällige Positionen für Paare (nicht ganz am Anfang, nicht am Ende)
    const candidates = [];
    for (let i = 2; i < words.length - 2; i += 2) candidates.push(i);
    // Shuffle und pick
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    for (let p = 0; p < numPairs && p < candidates.length; p++) {
      parallelSets.add(candidates[p]);
    }
  }

  // Spawn-Zeiten berechnen
  let currentSpawnMs = 0;
  const balloons = words.map((word, i) => {
    // Sichtbarkeit: zufällig zwischen BASE_MIN und BASE_MAX, skaliert mit Tempo
    const baseSecs = BASE_MIN_SECS + Math.random() * (BASE_MAX_SECS - BASE_MIN_SECS);
    const visibleSecs = baseSecs / tempoFactor;

    const spawnMs = currentSpawnMs;

    // Spacing zum nächsten Ballon: normalerweise etwas kürzer als Sichtbarkeit
    // Bei parallelen Ballonen: gleiche Spawn-Zeit wie der vorherige
    if (parallelSets.has(i)) {
      // Dieser Ballon startet GLEICHZEITIG mit dem vorherigen (Paar)
      // currentSpawnMs bleibt gleich — aber nach dem Paar normal weiter
      currentSpawnMs += visibleSecs * 0.5 * 1000;  // Nach dem Paar: halbe Sichtbarkeit warten
    } else {
      // Normaler Abstand: 45-60% der Sichtbarkeit
      const spacingFraction = 0.30 + Math.random() * 0.15;  // Nächster Ballon erscheint wenn vorheriger bei ~50%
      currentSpawnMs += visibleSecs * spacingFraction * 1000;
    }

    return {
      word,
      color: BALLOON_COLORS[i % BALLOON_COLORS.length],
      x: parallelSets.has(i)
        ? 0.55 + Math.random() * 0.3   // Paralleler Ballon: rechte Hälfte
        : 0.1 + Math.random() * 0.8,   // Normal: ganze Breite
      spawnMs,
      durationMs: visibleSecs * 1000,
      alive: true,
      popped: false,
      missPopped: false,
      popTime: 0,
      radius: 0,
    };
  });

  // Falls paralleler Ballon existiert, vorherigen nach links verschieben
  balloons.forEach((b, i) => {
    if (parallelSets.has(i) && i > 0) {
      balloons[i - 1].x = 0.1 + Math.random() * 0.3;  // Linke Hälfte
    }
  });

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width: 100%; border-radius: 16px; border: 2px solid var(--border); display: block;';
  const ctx = canvas.getContext('2d');

  const inputEl = el('input', {
    type: 'text',
    placeholder: 'Wort tippen…',
    autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
    style: 'width:100%;background:var(--bg-deep);border:2px solid var(--accent);border-radius:12px;padding:1rem 1.2rem;font-family:var(--font-mono);font-size:1.2rem;color:var(--text);text-align:center;outline:none;'
  });

  const timerEl = el('div', { class: 'timer' }, '30s');
  const statsBar = el('div', { style: 'display:flex;justify-content:center;gap:1.5rem;font-family:var(--font-mono);font-size:0.85rem;color:var(--text-dim);' });
  const hitEl = el('span', {}, '🎈 0');
  const missEl = el('span', {}, '💨 0');
  statsBar.appendChild(hitEl);
  statsBar.appendChild(missEl);
  const doneMsg = el('div', { class: 'done-msg', style: 'display: none;' });

  // ─── INPUT HANDLER ───
  inputEl.addEventListener('input', () => {
    if (finished) return;
    if (!firstKeyAt) firstKeyAt = Date.now();

    const raw = inputEl.value;
    const typed = raw.trim();

    const hitBalloon = balloons.find(b =>
      b.alive && !b.popped && !b.missPopped &&
      b.word.toLowerCase() === typed.toLowerCase()
    );
    if (hitBalloon) {
      hitBalloon.popped = true;
      hitBalloon.popTime = Date.now();
      wordsHit++;
      totalCorrectChars += hitBalloon.word.length;
      hitEl.textContent = '🎈 ' + wordsHit;
      inputEl.value = '';
      const progress = (wordsHit + wordsMissed) / words.length;
      update(ref(db, `rooms/${roomCode}/players/${playerId}`), { progress });
      return;
    }

    if (raw.endsWith(' ') && typed.length > 0) {
      inputEl.value = '';
    }
  });

  // Enter-Handler: Input leeren
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      inputEl.value = '';
    }
  });

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }

  function drawBalloon(b, canvasW, canvasH) {
    const x = b.x * canvasW;
    const y = b.y * canvasH;
    // Radius an Wortlänge anpassen: längere Wörter = grössere Ballone
    const wordLen = b.word.length;
    const baseR = Math.max(64, Math.min(110, canvasW * 0.13));
    const r = Math.max(baseR, wordLen * 9 + 24);  // Min 12+4.5*chars Pixel
    b.radius = r;

    if (b.popped || b.missPopped) {
      const elapsed = Date.now() - b.popTime;
      if (elapsed > 400) { b.alive = false; return; }
      const scale = 1 + (elapsed / 400) * 0.5;
      const alpha = 1 - elapsed / 400;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, r * scale, 0, Math.PI * 2);
      ctx.fillStyle = b.popped ? b.color : '#999';
      ctx.fill();
      ctx.fillStyle = '#2c2520';
      ctx.font = `bold ${Math.round(r * 0.5)}px "Bricolage Grotesque", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(b.popped ? 'POP!' : '💨', x, y + r * 0.15);
      ctx.globalAlpha = 1;
      return;
    }

    // Ballon-Form: breiter für lange Wörter
    const widthRatio = Math.max(0.85, Math.min(1.2, wordLen * 0.08));
    ctx.beginPath();
    ctx.ellipse(x, y, r * widthRatio, r, 0, 0, Math.PI * 2);
    ctx.fillStyle = b.color;
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(x - r * widthRatio * 0.25, y - r * 0.3, r * 0.15, r * 0.25, -0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(x, y + r);
    ctx.quadraticCurveTo(x + 5, y + r + 15, x - 3, y + r + 30);
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Schrift: Grösse ans Wort anpassen, mit Schatten für Lesbarkeit
    const maxFontForBalloon = (r * 1.5) / Math.max(wordLen, 1);
    const fontSize = Math.max(14, Math.min(20, maxFontForBalloon));
    ctx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Text-Schatten für Kontrast
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillText(b.word, x + 1, y + 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(b.word, x, y);

    const currentInput = inputEl.value.trim().toLowerCase();
    if (currentInput.length > 0 && b.word.toLowerCase().startsWith(currentInput)) {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x, y, r * widthRatio + 4, r + 4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function gameLoop() {
    if (finished) return;
    const canvasW = canvas.width / window.devicePixelRatio;
    const canvasH = canvas.height / window.devicePixelRatio;

    const skyGrad = ctx.createLinearGradient(0, 0, 0, canvasH);
    skyGrad.addColorStop(0, '#87CEEB');
    skyGrad.addColorStop(0.6, '#B0E0F0');
    skyGrad.addColorStop(1, '#E8F4F8');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, canvasW, canvasH);

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    const t = Date.now() * 0.00003;
    for (let i = 0; i < 4; i++) {
      const cx = ((t * (0.8 + i * 0.3) + i * 0.25) % 1.4 - 0.2) * canvasW;
      const cy = 20 + i * 35;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 50 + i * 10, 18, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 30, cy - 5, 35, 14, 0, 0, Math.PI * 2);
      ctx.ellipse(cx - 25, cy + 3, 30, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const remaining = Math.max(0, maxMs - (Date.now() - startedAt));
    timerEl.textContent = Math.ceil(remaining / 1000) + 's';
    timerEl.classList.toggle('warn', remaining < 5000);

    let allDone = true;
    const now = Date.now();
    balloons.forEach(b => {
      if (!b.alive) return;
      if (b.popped || b.missPopped) {
        drawBalloon(b, canvasW, canvasH);
        if (b.alive) allDone = false;
        return;
      }

      allDone = false;
      const elapsed = now - startedAt - b.spawnMs;
      if (elapsed < 0) return;  // Noch nicht gespawnt
      const progress = elapsed / b.durationMs;
      b.y = 1.15 - progress * 1.3;

      if (b.y < -0.15) {
        b.missPopped = true;
        b.popTime = now;
        wordsMissed++;
        missEl.textContent = '💨 ' + wordsMissed;
        const prog = (wordsHit + wordsMissed) / words.length;
        update(ref(db, `rooms/${roomCode}/players/${playerId}`), { progress: prog });
        return;
      }

      drawBalloon(b, canvasW, canvasH);
    });

    if (remaining <= 0 || allDone) { finishGame(); return; }
    animFrameId = requestAnimationFrame(gameLoop);
  }

  async function finishGame() {
    if (finished) return;
    finished = true;
    if (animFrameId) cancelAnimationFrame(animFrameId);
    inputEl.disabled = true;

    const usedMs = Date.now() - startedAt;
    const typingMs = firstKeyAt ? (Date.now() - firstKeyAt) : usedMs;
    const points = calcPoints({ correct: wordsHit, total: words.length, errors: wordsMissed, usedMs, maxMs });

    const playerSnap = await get(ref(db, `rooms/${roomCode}/players/${playerId}`));
    const cur = playerSnap.val() || { score: 0 };
    await update(ref(db, `rooms/${roomCode}/players/${playerId}`), {
      score: (cur.score || 0) + points, lastDelta: points, progress: 1, status: 'done', finishedAt: Date.now(),
      totalCorrect: (cur.totalCorrect || 0) + totalCorrectChars,
      totalChars: (cur.totalChars || 0) + words.reduce((s, w) => s + w.length, 0),
      totalErrors: (cur.totalErrors || 0) + wordsMissed,
      totalTimeMs: (cur.totalTimeMs || 0) + typingMs,
      roundsPlayed: (cur.roundsPlayed || 0) + 1
    });

    canvas.style.display = 'none'; inputEl.style.display = 'none'; statsBar.style.display = 'none';
    doneMsg.style.display = 'block'; doneMsg.innerHTML = '';
    doneMsg.appendChild(el('h2', {}, '🎈 Runde fertig!'));
    doneMsg.appendChild(el('div', { class: 'points' }, '+' + points));
    doneMsg.appendChild(el('div', { style: 'color:var(--text-dim);font-family:var(--font-mono);margin-top:1rem' },
      `${wordsHit}/${words.length} geplatzt · ${wordsMissed} entwischt`));
  }

  clearRoot(root);
  root.appendChild(el('div', { class: 'game' }, [
    el('div', { class: 'game-header' }, [
      el('div', { class: 'timer-wrap' }, [timerEl]),
      el('div', { class: 'game-header-top' }, [
        el('div', {}, [
          el('span', { class: 'lesson-tag' }, '🎈 Ballon-Pop'),
          el('div', { class: 'round-info', style: 'margin-top: 0.5rem' }, [
            'Runde ', el('strong', {}, `${state.round}`), ` / ${totalRounds}`
          ])
        ])
      ])
    ]),
    canvas, inputEl, statsBar, doneMsg
  ]));

  canvas.style.height = '510px';
  setTimeout(() => { resizeCanvas(); inputEl.focus(); gameLoop(); }, 100);
  window.addEventListener('resize', () => resizeCanvas());
}
