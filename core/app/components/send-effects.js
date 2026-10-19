// The bubble and screen effects a message was sent with (issue 442), played through the kit (core/kit/motion.js), so
// every one runs on the motion tokens and none plays under reduced motion. A bubble effect moves the message's own
// bubble; a screen effect draws its pieces in the one layer over the conversation, laid out by the pure
// core/app/rules/send-effects.js, coloured by the chart tokens and sized by the size tokens in the stylesheet, and
// takes them away again once it has played. Every distance here is a fraction of the bubble or the conversation, or a
// token read from the page.
import { play, reducedMotion, cssVar } from '../../kit/motion.js';
import { effectPieces } from '../rules/send-effects.js';

const px = (el, name) => parseFloat(cssVar(el, name)) || 0;
const finished = (a) => (a && a.finished ? a.finished.catch(() => {}) : Promise.resolve());

// Slam drops the bubble in hard from above, Loud swells it and shakes it, Gentle eases it in small and slowly.
// Invisible Ink has no arrival of its own: its veil shimmers in the stylesheet until the bubble is pressed.
export function playBubbleEffect(bubble, effect) {
  if (!bubble) return null;
  const lift = px(bubble, '--space-6');
  const id = 'send-' + effect;
  if (effect === 'slam') {
    return play(bubble, [
      { opacity: 0, scale: '2.6', translate: '0px ' + -lift * 2 + 'px' },
      { opacity: 1, scale: '0.92', translate: '0px 0px', offset: 0.55 },
      { scale: '1.04', offset: 0.75 },
      { opacity: 1, scale: '1', translate: '0px 0px' },
    ], { duration: 'send-bubble', easing: 'ease', id });
  }
  if (effect === 'loud') {
    const shake = px(bubble, '--space-1');
    return play(bubble, [
      { scale: '1', translate: '0px 0px' },
      { scale: '1.7', offset: 0.25 },
      { scale: '1.7', translate: -shake + 'px 0px', offset: 0.4 },
      { scale: '1.7', translate: shake + 'px 0px', offset: 0.5 },
      { scale: '1.7', translate: -shake + 'px 0px', offset: 0.6 },
      { scale: '1.7', translate: '0px 0px', offset: 0.7 },
      { scale: '1', translate: '0px 0px' },
    ], { duration: 'send-bubble', easing: 'ease', id });
  }
  if (effect === 'gentle') {
    return play(bubble, [
      { opacity: 0.4, scale: '0.45' },
      { opacity: 1, scale: '0.55', offset: 0.6 },
      { opacity: 1, scale: '1' },
    ], { duration: 'send-gentle', easing: 'ease', id });
  }
  return null;
}

function piece(layer, kind, tone, text = '') {
  const el = document.createElement('span');
  el.className = 'fx-piece fx-' + kind;
  el.dataset.tone = String(tone);
  if (text) el.textContent = text;
  layer.append(el);
  return el;
}

// The keyframes each piece of a screen effect moves through, from where the layout puts it, in the conversation's own
// pixels (w by h). size is the piece's own size, read once it is drawn.
function pieceMotion(effect, p, i, { w, h, size, from }) {
  const at = (x, y) => x + 'px ' + y + 'px';
  const x = p.x * w;
  const y = p.y * h;
  switch (effect) {
    case 'balloons': {
      const sway = (p.turn - 0.5) * size;
      return [{ translate: at(x - size / 2, h + size), opacity: 1 }, { translate: at(x - size / 2 + sway, h * 0.4), offset: 0.55 }, { translate: at(x - size / 2 - sway, -size * 2), opacity: 1 }];
    }
    case 'confetti': {
      const drift = (p.turn - 0.5) * w * 0.3;
      return [{ translate: at(x, -size), rotate: '0deg', opacity: 1 }, { translate: at(x + drift / 2, h * 0.5), rotate: Math.round(p.turn * 360 + 180) + 'deg', offset: 0.5 }, { translate: at(x + drift, h + size), rotate: Math.round(p.turn * 720 + 360) + 'deg', opacity: 0.8 }];
    }
    case 'love': {
      if (i === 0) return [{ translate: at(w / 2 - size / 2, h / 2 - size / 2), scale: '0', opacity: 0 }, { scale: '6', opacity: 1, offset: 0.35 }, { scale: '5.4', opacity: 1, offset: 0.7 }, { translate: at(w / 2 - size / 2, h / 2 - size / 2), scale: '7', opacity: 0 }];
      return [{ translate: at(x, h), scale: '0.6', opacity: 0 }, { opacity: 1, offset: 0.2 }, { translate: at(x + (p.turn - 0.5) * size * 3, -size), scale: '1.4', opacity: 0 }];
    }
    case 'lasers': {
      const swing = 40 + p.turn * 50;
      const start = Math.round(180 + p.turn * 180);
      return [{ translate: at(w / 2, h * 0.35), rotate: start + 'deg', opacity: 0 }, { opacity: 1, offset: 0.15 }, { rotate: start + swing + 'deg', offset: 0.5 }, { rotate: start - swing / 2 + 'deg', opacity: 1, offset: 0.85 }, { translate: at(w / 2, h * 0.35), rotate: start + 'deg', opacity: 0 }];
    }
    case 'fireworks': {
      const reach = Math.min(w, h) * 0.28;
      const angle = p.turn * Math.PI * 2;
      const tx = x + Math.cos(angle) * reach;
      const ty = y + Math.sin(angle) * reach;
      return [{ translate: at(x, y), scale: '0.4', opacity: 0 }, { translate: at(x, y), scale: '1', opacity: 1, offset: 0.08 }, { translate: at(tx, ty), scale: '1', opacity: 1, offset: 0.55 }, { translate: at(tx, ty + reach * 0.4), scale: '0.3', opacity: 0 }];
    }
    case 'celebration':
      return [{ translate: at(x, y - size), scale: '0', opacity: 0 }, { scale: '1.6', opacity: 1, offset: 0.3 }, { scale: '0.6', opacity: 0.6, offset: 0.6 }, { translate: at(x - w * 0.15, y + h * 0.3), scale: '0', opacity: 0 }];
    case 'shooting-star': {
      const lag = i * size;
      return [{ translate: at(-size - lag, h * 0.15), scale: i ? '0.5' : '1', opacity: i ? 0.7 : 1 }, { translate: at(w * 0.6 - lag, h * 0.32), offset: 0.6 }, { translate: at(w + size, h * 0.45), scale: i ? '0.2' : '1.4', opacity: 0 }];
    }
    case 'echo': {
      const dx = (p.turn - 0.5) * w * 0.4;
      return [{ translate: at(from.x, from.y), opacity: 0 }, { translate: at(x * 0.7, y), opacity: 0.9, offset: 0.35 }, { translate: at(x * 0.7 + dx, y), opacity: 0 }];
    }
    case 'spotlight':
      return [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }];
    default:
      return [];
  }
}

const SHAPES = { balloons: 'balloon', confetti: 'confetti', love: 'heart', lasers: 'beam', fireworks: 'spark', celebration: 'sparkle', 'shooting-star': 'star', echo: 'echo', spotlight: 'spot' };
// The two that draw a glyph rather than a shape: a heart and a star, in the text presentation so they take the colour.
const GLYPHS = { heart: '\u2665', star: '\u2605' };

// A screen effect over the conversation: the layer is cleared of any effect still playing, the new one's pieces are
// drawn into it and moved, and once every one has finished the layer is empty again. Nothing is drawn under reduced
// motion. bubble is the message's own bubble, which Spotlight lights and Echo repeats from; text is its words.
export function playScreenEffect(layer, effect, { bubble = null, text = '' } = {}) {
  if (!layer) return null;
  if (reducedMotion()) return null;
  const seq = (Number(layer.dataset.seq) || 0) + 1;
  layer.dataset.seq = String(seq);
  layer.replaceChildren();
  layer.dataset.effect = effect;
  const box = layer.getBoundingClientRect();
  const w = box.width;
  const h = box.height;
  const b = bubble ? bubble.getBoundingClientRect() : null;
  const from = b ? { x: b.left - box.left, y: b.top - box.top } : { x: w / 2, y: h / 2 };
  const shape = SHAPES[effect];
  if (!shape || !(w > 0) || !(h > 0)) return null;
  const pieces = effectPieces(effect);
  const playing = pieces.map((p, i) => {
    const el = piece(layer, shape, p.tone, shape === 'echo' ? text : GLYPHS[shape] || '');
    if (shape === 'spot' && b) {
      // The light sits over the message itself; everything around it is dimmed by its shadow.
      el.style.left = from.x + 'px';
      el.style.top = from.y + 'px';
      el.style.width = b.width + 'px';
      el.style.height = b.height + 'px';
    }
    if (i === 0 && effect === 'love') el.classList.add('fx-heart-big');
    const size = el.getBoundingClientRect().width || px(el, '--space-2');
    const frames = pieceMotion(effect, p, i, { w, h, size, from });
    const spread = effect === 'confetti' || effect === 'balloons' || effect === 'celebration' ? 0.35 : effect === 'echo' ? 0.4 : 0.25;
    const ms = parseFloat(cssVar(el, '--motion-send-screen')) || 0;
    return play(el, frames, { duration: 'send-screen', easing: 'ease', id: 'send-' + effect, delay: Math.round(p.delay * spread * ms), fill: 'both' });
  });
  const done = Promise.all(playing.map(finished)).then(() => {
    if (layer.dataset.seq !== String(seq)) return;
    layer.replaceChildren();
    delete layer.dataset.effect;
  });
  return done;
}
