// Pure: the effects a sender can send a message with (issue 442). The Mac's store records the one chosen on the
// message's own row, in expressive_send_style_id, as an identifier of its own; the server reads it from the store and
// the model carries it as sendEffect, one of the keys here. A bubble effect plays on the message's bubble; a screen
// effect plays over the conversation. Either plays as the message arrives in the conversation on screen, and a quiet
// line under the message names it.

// Each effect: the key the model carries, the name a person reads, and where it plays.
export const SEND_EFFECTS = Object.freeze({
  slam: Object.freeze({ name: 'Slam', kind: 'bubble' }),
  loud: Object.freeze({ name: 'Loud', kind: 'bubble' }),
  gentle: Object.freeze({ name: 'Gentle', kind: 'bubble' }),
  'invisible-ink': Object.freeze({ name: 'Invisible Ink', kind: 'bubble' }),
  echo: Object.freeze({ name: 'Echo', kind: 'screen' }),
  spotlight: Object.freeze({ name: 'Spotlight', kind: 'screen' }),
  balloons: Object.freeze({ name: 'Balloons', kind: 'screen' }),
  confetti: Object.freeze({ name: 'Confetti', kind: 'screen' }),
  love: Object.freeze({ name: 'Love', kind: 'screen' }),
  lasers: Object.freeze({ name: 'Lasers', kind: 'screen' }),
  fireworks: Object.freeze({ name: 'Fireworks', kind: 'screen' }),
  celebration: Object.freeze({ name: 'Celebration', kind: 'screen' }),
  'shooting-star': Object.freeze({ name: 'Shooting Star', kind: 'screen' }),
});
export const BUBBLE_EFFECTS = Object.freeze(Object.keys(SEND_EFFECTS).filter((k) => SEND_EFFECTS[k].kind === 'bubble'));
export const SCREEN_EFFECTS = Object.freeze(Object.keys(SEND_EFFECTS).filter((k) => SEND_EFFECTS[k].kind === 'screen'));

// The words a sender sent with Invisible Ink stay hidden until the bubble is pressed, so nothing else shows them either.
export const INK_EFFECT = 'invisible-ink';

// The store's own identifier for each effect, as its expressive_send_style_id column holds it.
export const SEND_STYLES = Object.freeze({
  'com.apple.MobileSMS.expressivesend.impact': 'slam',
  'com.apple.MobileSMS.expressivesend.loud': 'loud',
  'com.apple.MobileSMS.expressivesend.gentle': 'gentle',
  'com.apple.MobileSMS.expressivesend.invisibleink': 'invisible-ink',
  'com.apple.messages.effect.CKEchoEffect': 'echo',
  'com.apple.messages.effect.CKSpotlightEffect': 'spotlight',
  'com.apple.messages.effect.CKHappyBirthdayEffect': 'balloons',
  'com.apple.messages.effect.CKConfettiEffect': 'confetti',
  'com.apple.messages.effect.CKHeartEffect': 'love',
  'com.apple.messages.effect.CKLasersEffect': 'lasers',
  'com.apple.messages.effect.CKFireworksEffect': 'fireworks',
  'com.apple.messages.effect.CKSparklesEffect': 'celebration',
  'com.apple.messages.effect.CKShootingStarEffect': 'shooting-star',
});

const known = (key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(SEND_EFFECTS, key);

// The key for a style identifier the store recorded, or null for none and for one this app has no way to play.
export function sendEffectOf(styleId) {
  return typeof styleId === 'string' && Object.prototype.hasOwnProperty.call(SEND_STYLES, styleId) ? SEND_STYLES[styleId] : null;
}

export function sendEffectName(key) {
  return known(key) ? SEND_EFFECTS[key].name : '';
}

export function sendEffectKind(key) {
  return known(key) ? SEND_EFFECTS[key].kind : null;
}

// The quiet line under a message sent with an effect: "Sent with Confetti".
export function sendEffectLine(key) {
  return known(key) ? 'Sent with ' + SEND_EFFECTS[key].name : '';
}

// How many pieces each screen effect draws over the conversation.
const PIECES = Object.freeze({ echo: 12, spotlight: 1, balloons: 10, confetti: 40, love: 9, lasers: 6, fireworks: 36, celebration: 24, 'shooting-star': 7 });
const GOLDEN = 0.6180339887498949;
const frac = (v) => v - Math.floor(v);
const round = (v) => Math.round(v * 1000) / 1000;

// Where each piece of a screen effect starts, as fractions of the conversation (x across, y down), when it starts as a
// fraction of the effect's duration, which of the five chart colours it takes, and a turn (0 to 1) it may spin or aim
// by. The layout is a low-discrepancy sequence rather than a random one, so an effect plays the same way every time
// and on every platform, and its pieces spread evenly rather than clumping.
export function effectPieces(effect) {
  const n = PIECES[effect] || 0;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const a = frac(0.5 + i * GOLDEN);
    const b = frac(0.25 + i * GOLDEN * GOLDEN);
    const c = frac(0.75 + i * 0.7548776662466927);
    let piece = { x: a, y: b, delay: c, tone: (i % 5) + 1, turn: frac(i * 0.4142135623730951) };
    if (effect === 'fireworks') {
      // Three bursts, each a ring of twelve sparks aimed evenly round its centre.
      const burst = Math.floor(i / 12);
      piece = { x: [0.3, 0.7, 0.5][burst], y: [0.3, 0.25, 0.5][burst], delay: burst / 4, tone: burst + 1, turn: (i % 12) / 12 };
    } else if (effect === 'spotlight') {
      piece = { x: 0.5, y: 0.5, delay: 0, tone: 1, turn: 0 };
    } else if (effect === 'love') {
      // The first is the one large heart; the rest float up behind it.
      piece = i === 0 ? { x: 0.5, y: 0.5, delay: 0, tone: 1, turn: 0 } : { ...piece, tone: 1, delay: c / 2 };
    } else if (effect === 'shooting-star') {
      // The star, then its trail a step behind it.
      piece = { x: 0, y: 0.2, delay: i / 20, tone: 3, turn: i / n };
    } else if (effect === 'lasers') {
      piece = { x: 0.5, y: 0.35, delay: (i % 2) / 8, tone: (i % 5) + 1, turn: i / n };
    } else if (effect === 'celebration') {
      // Sparkles that shower down from the top corner.
      piece = { ...piece, x: 1 - a * a, y: b * b, tone: 3 };
    }
    out.push({ x: round(piece.x), y: round(piece.y), delay: round(piece.delay), tone: piece.tone, turn: round(piece.turn) });
  }
  return out;
}
