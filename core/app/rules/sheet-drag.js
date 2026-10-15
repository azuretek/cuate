// Pure: whether a drag on a sheet's handle or header lets the sheet go (issue 338). A drag let go past a quarter of the
// card's height (never less than DRAG_MIN and never more than DRAG_MAX, so a short card still needs a real pull and a
// tall one is not a long haul) goes back; so does a downward flick of at least FLICK_VELOCITY once the finger has moved
// FLICK_MIN. Anything less springs back into place.
export const DRAG_FRACTION = 0.25;
export const DRAG_MIN = 64;
export const DRAG_MAX = 160;
export const FLICK_VELOCITY = 0.6;
export const FLICK_MIN = 24;

export function dragThreshold(height) {
  const h = Number(height) > 0 ? Number(height) : 0;
  return Math.min(DRAG_MAX, Math.max(DRAG_MIN, h * DRAG_FRACTION));
}

export function dragOutcome({ dy = 0, velocity = 0, height = 0 } = {}) {
  if (!(dy > 0)) return 'stay';
  if (velocity >= FLICK_VELOCITY && dy >= FLICK_MIN) return 'dismiss';
  return dy >= dragThreshold(height) ? 'dismiss' : 'stay';
}
