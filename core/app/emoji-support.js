// Whether this device draws an emoji (issue 392), measured rather than looked up: a device's emoji are whatever its
// fonts hold, so the only honest answer is to draw the character and look. Each emoji is drawn once on a small canvas
// in the page's own font, and the decision over what was drawn is the pure glyphDrawn() in rules/emoji.js: nothing
// drawn, the box a font draws for a character it lacks (two noncharacters, which no font will ever draw, show what
// that box looks like here), or a sequence drawn as its parts side by side. Answers are kept for the page's life, so
// a panel or a conversation measures each emoji at most once. Where there is no canvas (a test, a bare engine) every
// emoji counts as drawable, so the check can only ever hide what was proven missing.
import { glyphDrawn } from './rules/emoji.js';

const SIZE = 24;
const known = new Map();
let probe;

function makeProbe() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE * 3;
    canvas.height = SIZE * 2;
    const ctx = canvas.getContext && canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || typeof ctx.measureText !== 'function' || typeof ctx.getImageData !== 'function') return null;
    const family = typeof getComputedStyle === 'function' && document.body ? getComputedStyle(document.body).fontFamily : '';
    ctx.font = SIZE + 'px ' + (family || 'sans-serif');
    ctx.textBaseline = 'top';
    const draw = (char) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillText(char, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 0;
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        ink += 1;
        hash = (hash * 31 + (i >> 2) * 7 + data[i] + data[i + 1] * 3 + data[i + 2] * 5) >>> 0;
      }
      return { width: ctx.measureText(char).width, blank: ink === 0, signature: ink + ':' + hash };
    };
    const reference = draw('\u{1F600}').width;
    const missing = ['\u{10FFFF}', '\u{1FFFE}'].map((c) => draw(c)).filter((m) => !m.blank).map((m) => m.signature);
    return { draw, reference, missing };
  } catch {
    return null;
  }
}

export function canDrawEmoji(char) {
  const c = String(char ?? '');
  if (!c) return true;
  if (known.has(c)) return known.get(c);
  if (probe === undefined) probe = makeProbe();
  let answer = true;
  if (probe) {
    try {
      const m = probe.draw(c);
      answer = glyphDrawn({ ...m, reference: probe.reference, missing: probe.missing });
    } catch {
      answer = true;
    }
  }
  known.set(c, answer);
  return answer;
}
