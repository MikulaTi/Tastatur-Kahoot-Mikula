import { SENTENCE_POOL, WORD_POOL } from './game-config.js';

const _usedSentences = new Set();
const _usedWords = new Set();

const BLOCKED_PATTERNS = [
  /rassist/i, /nazi/i, /hitler/i, /holocaust/i, /sexist/i, /sexuell/i, /porno/i, /\bsex\b/i,
  /diskriminier/i, /hass\b/i, /gewalt/i, /waffe/i, /mord/i, /töt/i, /umbring/i,
  /drog/i, /kokain/i, /heroin/i, /schimpf/i, /beleidig/i, /hurensohn/i,
  /schwuchtel/i, /nigger/i, /neger/i, /fick/i, /fotze/i, /arsch(?!äolog)/i,
  /behindert/i, /spast/i, /mongo/i, /nutte/i, /\bhure\b/i, /schlamp/i,
  /terror/i, /bombe/i, /anschlag/i, /suizid/i, /selbstmord/i,
];

function isTopicBlocked(topic) {
  if (topic.trim().length > 100) return true;
  return BLOCKED_PATTERNS.some(p => p.test(topic));
}

export async function generateSentences(topic, numSentences = 10) {
  if (!topic || !topic.trim()) return { sentences: pickRandomSentences(numSentences), blocked: false };
  if (isTopicBlocked(topic)) return { sentences: pickRandomSentences(numSentences), blocked: true };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', max_tokens: 2000,
        messages: [{ role: 'user', content: `Du bist ein Satz-Generator für ein Tipp-Lernspiel für Schweizer Schüler*innen (8. Klasse, Sekundarstufe I, Kanton Basel-Landschaft).

THEMA: "${topic.trim()}"

Generiere genau ${numSentences} kurze deutsche Sätze zum Thema "${topic.trim()}".

TONALITÄT:
- Bei ERNSTEN Themen (Krieg, Krankheit, Tod, Armut): sachlich und respektvoll.
- Bei UNBESCHWERTEM Thema: humorvoll, gerne Redewendungen oder Sprichwörter.

REGELN:
- Jeder Satz maximal 70 Zeichen.
- Grammatikalisch korrekt und sinnvoll.
- KEINE Bindestriche (-, –, —) verwenden! Auch keine Gedankenstriche.
- Keine diskriminierenden, rassistischen oder beleidigenden Inhalte.
- Sprache: Deutsch.

Antworte NUR mit einem JSON-Array von Strings.` }]
      })
    });
    if (!response.ok) return { sentences: pickRandomSentences(numSentences), blocked: false };
    const data = await response.json();
    const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    if (!Array.isArray(parsed) || parsed.length < numSentences) return { sentences: pickRandomSentences(numSentences), blocked: false };

    const sentences = parsed.slice(0, numSentences).map(s => {
      const t = (typeof s === 'string') ? s.trim() : '';
      if (t.length >= 5 && t.length <= 80 && !t.includes('–') && !t.includes('—')) return { lesson: 'Thema', text: t };
      return pickOneSentence();
    });
    sentences.forEach(s => _usedSentences.add(s.text));
    return { sentences, blocked: false };
  } catch (e) {
    console.error('Satzgenerierung fehlgeschlagen:', e);
    return { sentences: pickRandomSentences(numSentences), blocked: false };
  }
}

function pickRandomSentences(count) {
  const available = SENTENCE_POOL.filter(s => !_usedSentences.has(s));
  const pool = available.length >= count ? available : [...SENTENCE_POOL];
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]; }
  const result = [];
  for (let i = 0; i < count && i < shuffled.length; i++) { _usedSentences.add(shuffled[i]); result.push({ lesson: 'Klassik', text: shuffled[i] }); }
  return result;
}

function pickOneSentence() {
  const available = SENTENCE_POOL.filter(s => !_usedSentences.has(s));
  const pool = available.length > 0 ? available : SENTENCE_POOL;
  const text = pool[Math.floor(Math.random() * pool.length)];
  _usedSentences.add(text);
  return { lesson: 'Klassik', text };
}

export async function generateWords(topic, numWords = 8) {
  if (topic && topic.trim() && !isTopicBlocked(topic)) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 500,
          messages: [{ role: 'user', content: `Generiere genau ${numWords} einzelne deutsche Wörter zum Thema "${topic.trim()}".
Altersgerecht (13-15 Jahre), 3-12 Zeichen, KEINE Bindestriche. Nur ein JSON-Array.
Beispiel: ["Ritter","Burg","Schwert"]` }]
        })
      });
      if (response.ok) {
        const data = await response.json();
        const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
        if (Array.isArray(parsed) && parsed.length >= numWords) {
          const words = parsed.slice(0, numWords).map(w => String(w).trim()).filter(w => w.length >= 2 && w.length <= 15 && !w.includes('-'));
          if (words.length >= numWords) { words.forEach(w => _usedWords.add(w)); return words; }
        }
      }
    } catch (e) { console.error('Wort-Generierung fehlgeschlagen:', e); }
  }
  return pickRandomWords(numWords);
}

function pickRandomWords(count) {
  const available = WORD_POOL.filter(w => !_usedWords.has(w));
  const pool = available.length >= count ? available : [...WORD_POOL];
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]; }
  const result = [];
  for (let i = 0; i < count && i < shuffled.length; i++) { _usedWords.add(shuffled[i]); result.push(shuffled[i]); }
  return result;
}
