import { el, spawnConfetti, clearRoot } from './helpers.js';

export function showSetupWarning() {
  return el('div', { class: 'setup-warn' }, [
    'Firebase ist noch nicht konfiguriert. Bitte ',
    el('code', {}, 'src/firebase-config.js'),
    ' anlegen (siehe firebase-config.example.js).'
  ]);
}

function calcPlayerStats(p) {
  const totalCorrect = p.totalCorrect || 0;
  const totalChars   = p.totalChars || 1;
  const totalTimeMs  = p.totalTimeMs || 1;
  const roundsPlayed = p.roundsPlayed || 1;
  const totalTimeMin = totalTimeMs / 1000 / 60;
  const wpm = totalTimeMin > 0 ? Math.round((totalCorrect / 5) / totalTimeMin) : 0;
  const accuracy = Math.round((totalCorrect / totalChars) * 100);
  const avgTimeSec = Math.round(totalTimeMs / roundsPlayed / 1000 * 10) / 10;
  return { wpm, accuracy, avgTimeSec };
}

export function renderPodium(root, allPlayers, isHost, onRestart, myId = null) {
  const playerList = Object.entries(allPlayers)
    .filter(([, p]) => p)
    .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
  const top3 = playerList.slice(0, 3);
  const rest = playerList.slice(3);
  setTimeout(() => spawnConfetti(), 400);

  const podium = el('div', { class: 'podium' });
  const order = [];
  if (top3[1]) order.push({ ...top3[1][1], id: top3[1][0], spot: 's2', medal: '🥈' });
  if (top3[0]) order.push({ ...top3[0][1], id: top3[0][0], spot: 's1', medal: '🥇' });
  if (top3[2]) order.push({ ...top3[2][1], id: top3[2][0], spot: 's3', medal: '🥉' });

  order.forEach(p => {
    const stats = calcPlayerStats(p);
    podium.appendChild(el('div', { class: 'podium-spot ' + p.spot }, [
      el('div', { class: 'pname' }, p.name + (p.id === myId ? ' (du)' : '')),
      el('div', { class: 'ppts' }, p.score + ' Punkte'),
      el('div', { class: 'podium-stats' }, [
        el('div', { class: 'podium-stat' }, [
          el('span', { class: 'podium-stat-val' }, String(stats.wpm)),
          el('span', { class: 'podium-stat-lbl' }, 'WPM')
        ]),
        el('div', { class: 'podium-stat' }, [
          el('span', { class: 'podium-stat-val' }, stats.accuracy + '%'),
          el('span', { class: 'podium-stat-lbl' }, 'Genau')
        ]),
        el('div', { class: 'podium-stat' }, [
          el('span', { class: 'podium-stat-val' }, stats.avgTimeSec + 's'),
          el('span', { class: 'podium-stat-lbl' }, 'Ø Zeit')
        ])
      ]),
      el('div', { class: 'block' }, p.medal)
    ]));
  });

  const restList = el('div', { class: 'runners-up' });
  rest.forEach(([id, p], i) => {
    const rank = i + 4;
    const stats = calcPlayerStats(p);
    const cls = ['lb-row'];
    if (id === myId) cls.push('me');
    restList.appendChild(el('div', {
      class: cls.join(' '), style: `animation-delay: ${1 + i * 0.1}s`
    }, [
      el('div', { class: 'rank' }, '#' + rank),
      el('div', { class: 'name' }, p.name + (id === myId ? ' (du)' : '')),
      el('div', { class: 'runner-stats' }, [
        el('span', { style: 'color: var(--accent)' }, stats.wpm + ' WPM'),
        el('span', { style: 'color: var(--text-dim)' }, ' · '),
        el('span', { style: 'color: var(--good)' }, stats.accuracy + '%'),
        el('span', { style: 'color: var(--text-dim)' }, ' · '),
        el('span', { style: 'color: var(--text-dim)' }, stats.avgTimeSec + 's'),
      ]),
      el('div', { class: 'pts' }, String(p.score || 0))
    ]));
  });

  clearRoot(root);
  root.appendChild(el('div', { class: 'podium-screen' }, [
    el('div', { class: 'crown' }, '👑'),
    el('h1', {}, [el('span', {}, 'Game'), ' Over']),
    el('div', { style: 'color: var(--text-dim); font-family: var(--font-mono); letter-spacing: 0.1em' }, 'Das Tipp-Duell ist entschieden'),
    podium,
    rest.length > 0 ? restList : null,
    isHost ? el('button', { class: 'restart-btn', onclick: onRestart }, '↻ Neues Spiel mit gleichen Spielern') : null
  ]));
}
