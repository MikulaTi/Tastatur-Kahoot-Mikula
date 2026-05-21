import { PLAYER_COLORS } from './game-config.js';

export function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e[k] = v;
    else e.setAttribute(k, v);
  }
  (Array.isArray(children) ? children : [children]).forEach(c => {
    if (c == null) return;
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  });
  return e;
}

export function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

export function uid() { return Math.random().toString(36).slice(2, 10); }
export function colorFor(idx) { return PLAYER_COLORS[idx % PLAYER_COLORS.length]; }

export function makeQR(text, size = 280) {
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}&margin=10`;
  return el('img', { src: url, alt: 'QR-Code', width: size, height: size });
}

export function renderTargetText(target, typed) {
  const wrap = el('span', {});
  for (let i = 0; i < target.length; i++) {
    let cls = 'ch ';
    if (i < typed.length) cls += typed[i] === target[i] ? 'done' : 'wrong';
    else if (i === typed.length) cls += 'cur';
    else cls += 'todo';
    const ch = target[i] === ' ' ? '\u00A0' : target[i];
    wrap.appendChild(el('span', { class: cls }, ch));
  }
  return wrap;
}

export function spawnConfetti() {
  const colors = ['#7a1530', '#c4243b', '#2d8a4e', '#2a7ab5', '#8b5ea7', '#c97a2e'];
  for (let i = 0; i < 80; i++) {
    const c = el('div', { class: 'confetti' });
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[Math.floor(Math.random() * colors.length)];
    c.style.animationDelay = Math.random() * 1.5 + 's';
    c.style.animationDuration = (2 + Math.random() * 2) + 's';
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 5000);
  }
}

export function clearRoot(root) {
  while (root.firstChild) root.removeChild(root.firstChild);
}
