import { ref, update, get } from 'firebase/database';
import { db } from './firebase.js';
import { el, clearRoot } from './helpers.js';
import { calcPoints, ROUND_TIME_MS, NUM_ROUNDS } from './game-config.js';

export function renderRunnerGame(root, roomCode, playerId, state) {
  const words = state.words || [];
  const startedAt = state.startedAt || Date.now();
  const maxMs = state.durationMs || ROUND_TIME_MS;
  const totalRounds = state.totalRounds || NUM_ROUNDS;

  let currentWordIdx = 0;
  let wordsHit = 0;
  let wordsMissed = 0;
  let totalCorrectChars = 0;
  let firstKeyAt = null;
  let finished = false;
  let runnerPos = 0;
  let stumbling = false;
  let stumbleEnd = 0;
  let animFrameId = null;

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:180px;border-radius:16px;border:2px solid var(--border);display:block;';
  const ctx = canvas.getContext('2d');

  const wordDisplay = el('div', { class: 'target-text', style: 'text-align:center;font-size:1.6rem;min-height:3rem;display:flex;align-items:center;justify-content:center;' });
  const inputEl = el('input', {
    type: 'text', placeholder: 'Wort tippen…',
    autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
    style: 'width:100%;background:var(--bg-deep);border:2px solid var(--accent);border-radius:12px;padding:1rem 1.2rem;font-family:var(--font-mono);font-size:1.2rem;color:var(--text);text-align:center;outline:none;'
  });
  const timerEl = el('div', { class: 'timer' }, '30s');
  const statusEl = el('div', { style: 'text-align:center;font-family:var(--font-mono);font-size:0.85rem;color:var(--text-dim);min-height:1.2em;' });
  const doneMsg = el('div', { class: 'done-msg', style: 'display:none;' });

  function showCurrentWord() {
    if (currentWordIdx >= words.length) { wordDisplay.textContent = '🏁 Ziel!'; return; }
    wordDisplay.innerHTML = '';
    const w = words[currentWordIdx];
    const typed = inputEl.value.trim();
    for (let i = 0; i < w.length; i++) {
      const span = document.createElement('span');
      span.className = 'ch ' + (i < typed.length ? (typed[i] === w[i] ? 'done' : 'wrong') : (i === typed.length ? 'cur' : 'todo'));
      span.textContent = w[i];
      wordDisplay.appendChild(span);
    }
    statusEl.textContent = `Wort ${currentWordIdx + 1} / ${words.length}`;
  }

  inputEl.addEventListener('input', () => {
    if (finished) return;
    if (!firstKeyAt) firstKeyAt = Date.now();
    const typed = inputEl.value.trim();
    const target = words[currentWordIdx] || '';

    if (typed.toLowerCase() === target.toLowerCase()) {
      wordsHit++; totalCorrectChars += target.length;
      runnerPos = Math.min(1, (currentWordIdx + 1) / words.length);
      currentWordIdx++; inputEl.value = '';
      const progress = currentWordIdx / words.length;
      update(ref(db, `rooms/${roomCode}/players/${playerId}`), { progress });
      if (currentWordIdx >= words.length) { finishGame(); return; }
      showCurrentWord(); return;
    }
    if (typed.length >= target.length && typed.toLowerCase() !== target.toLowerCase()) {
      wordsMissed++; stumbling = true; stumbleEnd = Date.now() + 500;
      inputEl.value = ''; showCurrentWord();
      inputEl.style.borderColor = 'var(--bad)';
      setTimeout(() => { inputEl.style.borderColor = 'var(--accent)'; }, 300);
      return;
    }
    showCurrentWord();
  });

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }

  function drawScene() {
    const w = canvas.width / window.devicePixelRatio;
    const h = canvas.height / window.devicePixelRatio;
    const skyGrad = ctx.createLinearGradient(0, 0, 0, h * 0.45);
    skyGrad.addColorStop(0, '#5BB8F5'); skyGrad.addColorStop(1, '#A8DBF0');
    ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, w, h * 0.45);
    ctx.fillStyle = '#B8B0A4'; ctx.fillRect(0, h * 0.25, w, h * 0.22);
    ctx.strokeStyle = '#A09888'; ctx.lineWidth = 1;
    for (let ty = 0; ty < 4; ty++) { ctx.beginPath(); ctx.moveTo(0, h*0.27+ty*h*0.05); ctx.lineTo(w, h*0.27+ty*h*0.05); ctx.stroke(); }
    ctx.fillStyle = '#4CAF50'; ctx.fillRect(0, h * 0.45, w, h * 0.12);
    const trackTop = h * 0.57; const trackH = h * 0.25;
    ctx.fillStyle = '#C84B31'; ctx.fillRect(0, trackTop, w, trackH);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
    for (let lane = 0; lane <= 4; lane++) { ctx.beginPath(); ctx.moveTo(0, trackTop+(lane/4)*trackH); ctx.lineTo(w, trackTop+(lane/4)*trackH); ctx.stroke(); }
    const groundY = trackTop + trackH * 0.5;
    ctx.fillStyle = '#8B7355'; ctx.fillRect(0, trackTop + trackH, w, h - trackTop - trackH);
    const trackLeft = 50; const trackRight = w - 50; const trackW = trackRight - trackLeft;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(trackLeft, trackTop); ctx.lineTo(trackLeft, trackTop+trackH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(trackRight, trackTop); ctx.lineTo(trackRight, trackTop+trackH); ctx.stroke();
    ctx.font = '24px sans-serif'; ctx.fillText('🏁', trackRight - 12, groundY - 14);
    for (let i = 1; i < words.length; i++) { const mx = trackLeft + (i/words.length)*trackW; ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(mx,trackTop); ctx.lineTo(mx,trackTop+trackH); ctx.stroke(); }
    const rx = trackLeft + runnerPos * trackW; const ry = groundY;
    const now = Date.now();
    ctx.save(); ctx.translate(rx, ry - 16); ctx.scale(-1, 1);
    if (stumbling && now < stumbleEnd) {
      const shake = Math.sin((now - stumbleEnd + 500) * 0.05) * 3;
      ctx.font = '32px sans-serif'; ctx.fillText('🏃', -16 + shake, 0);
      ctx.scale(-1, 1); ctx.font = '14px sans-serif'; ctx.fillText('💫', 10, -14);
    } else { stumbling = false; ctx.font = '32px sans-serif'; ctx.fillText('🏃', -16, 0); }
    ctx.restore();
    const barY = 8; const barH = 6;
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(trackLeft, barY, trackW, barH);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(trackLeft, barY, trackW * runnerPos, barH);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.strokeRect(trackLeft, barY, trackW, barH);
  }

  function gameLoop() {
    if (finished) return;
    const remaining = Math.max(0, maxMs - (Date.now() - startedAt));
    timerEl.textContent = Math.ceil(remaining / 1000) + 's';
    timerEl.classList.toggle('warn', remaining < 5000);
    drawScene();
    if (remaining <= 0) { finishGame(); return; }
    animFrameId = requestAnimationFrame(gameLoop);
  }

  async function finishGame() {
    if (finished) return; finished = true;
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
    canvas.style.display = 'none'; inputEl.style.display = 'none'; wordDisplay.style.display = 'none'; statusEl.style.display = 'none';
    doneMsg.style.display = 'block'; doneMsg.innerHTML = '';
    doneMsg.appendChild(el('h2', {}, '🏃 Runde fertig!'));
    doneMsg.appendChild(el('div', { class: 'points' }, '+' + points));
    doneMsg.appendChild(el('div', { style: 'color:var(--text-dim);font-family:var(--font-mono);margin-top:1rem' },
      `${wordsHit}/${words.length} geschafft · ${wordsMissed} Stolperer`));
  }

  clearRoot(root);
  root.appendChild(el('div', { class: 'game' }, [
    el('div', { class: 'game-header' }, [
      el('div', { class: 'timer-wrap' }, [timerEl]),
      el('div', { class: 'game-header-top' }, [
        el('div', {}, [
          el('span', { class: 'lesson-tag' }, '🏃 Tipp-Lauf'),
          el('div', { class: 'round-info', style: 'margin-top: 0.5rem' }, [
            'Runde ', el('strong', {}, `${state.round}`), ` / ${totalRounds}`
          ])
        ])
      ])
    ]),
    canvas, wordDisplay, inputEl, statusEl, doneMsg
  ]));
  setTimeout(() => { resizeCanvas(); showCurrentWord(); inputEl.focus(); gameLoop(); }, 100);
  window.addEventListener('resize', () => resizeCanvas());
}
