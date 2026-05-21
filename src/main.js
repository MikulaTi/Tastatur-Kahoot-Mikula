import './styles.css';
import { LOGO_SRC } from './logo.js';
import { el, clearRoot } from './helpers.js';
import { startAsHost } from './host.js';
import { renderJoin } from './player.js';
import { showSetupWarning } from './podium.js';
import { SETUP_OK } from './firebase.js';

const root = document.getElementById('app');

// Logo oben rechts
const logoEl = el('img', { src: LOGO_SRC, alt: 'Sekundarschule Arlesheim-Münchenstein', class: 'school-logo' });
root.parentElement.style.position = 'relative';
document.body.appendChild(logoEl);

// Footer: Copyright links, QR mitte, Beenden rechts
const footerLink = el('a', { href: 'https://www.sekam.ch', style: 'color:var(--accent);text-decoration:none;' }, 'Sek. AM');
footerLink.setAttribute('target', '_blank');

const footerQR = el('div', { class: 'footer-qr', style: 'cursor:pointer;' });
window._footerQR = footerQR;
footerQR.addEventListener('click', () => { if (window._currentJoinUrl) showQROverlay(window._currentJoinUrl); });

const footerEndBtn = el('button', { class: 'footer-end-btn', style: 'display:none;', onclick: () => { if (window._forceEndGame) window._forceEndGame(); } }, 'Spiel beenden');
window._footerEndBtn = footerEndBtn;

const footer = el('div', { class: 'app-footer' }, [
  el('div', { class: 'footer-left' }, ['© PICTS ', footerLink, ' (Mik, Spo)']),
  footerQR, footerEndBtn
]);
document.body.appendChild(footer);

// QR-Overlay
function showQROverlay(url) {
  const existing = document.getElementById('qr-overlay');
  if (existing) { existing.remove(); return; }
  const qrSize = Math.min(400, window.innerWidth - 60);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${qrSize}x${qrSize}&data=${encodeURIComponent(url)}&margin=10`;
  const overlay = el('div', { id: 'qr-overlay', class: 'qr-overlay' }, [
    el('div', { class: 'qr-overlay-card' }, [
      el('div', { style: 'font-family:var(--font-display);font-weight:700;font-size:1.3rem;margin-bottom:0.5rem;' }, 'QR-Code zum Beitreten'),
      el('div', { style: 'background:white;padding:1.2rem;border-radius:12px;display:inline-block;' }, [
        el('img', { src: qrUrl, width: String(qrSize), height: String(qrSize), alt: 'QR-Code' })
      ]),
      el('div', { style: 'font-family:var(--font-mono);font-size:0.8rem;color:var(--text-dim);margin-top:0.8rem;word-break:break-all;' }, url.replace(/^https?:\/\//, '')),
      el('button', { class: 'next-btn', style: 'margin-top:1rem;', onclick: () => overlay.remove() }, 'Schliessen')
    ])
  ]);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}
window._showQROverlay = showQROverlay;

// Routing
function route() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  clearRoot(root);
  if (!SETUP_OK) { root.appendChild(showSetupWarning()); return; }
  if (room) { renderJoin(root, room.toUpperCase()); return; }

  root.appendChild(el('div', { class: 'start-screen' }, [
    el('h1', { class: 'logo-text' }, [el('span', {}, 'TYPE'), 'BATTLE']),
    el('div', { class: 'tagline' }, '10-Finger-Duell für mutige Tipp-Held*innen'),
    el('div', { class: 'start-cards' }, [
      el('div', { class: 'start-card', onclick: () => startAsHost(root) }, [
        el('div', { class: 'card-icon' }, '🖥️'),
        el('div', { class: 'card-title' }, 'Spiel starten (Host)'),
        el('div', { class: 'card-desc' }, 'Lehrkraft / Beamer-Gerät. Erstellt einen Raum mit QR-Code für die Klasse.')
      ]),
      el('div', { class: 'start-card', onclick: () => renderJoin(root) }, [
        el('div', { class: 'card-icon' }, '🎮'),
        el('div', { class: 'card-title' }, 'Mitspielen'),
        el('div', { class: 'card-desc' }, 'Schüler*in. Raumcode eingeben oder QR-Code scannen.')
      ])
    ])
  ]));
}
route();
