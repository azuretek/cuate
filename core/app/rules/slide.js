// Pure: the slide-to-confirm control that guards a destructive action (issue 137). A press alone does nothing; the
// thumb has to be carried to the far end of its track. Letting go short of the end returns it to the start.

// How far along the track counts as the end. A little short of the very end, so a drag that reaches the edge on a
// trackpad is not lost to a pixel of rounding.
export const SLIDE_CONFIRM_AT = 0.9;

// The keyboard step, so the control works without a pointer: the arrows move it a tenth at a time, Home and End jump.
export const SLIDE_KEY_STEP = 0.1;

// Progress from 0 to 1 for a thumb carried `offset` pixels along a track it can travel `travel` pixels on.
export function slideProgress(offset, travel) {
  if (!(travel > 0) || !Number.isFinite(offset)) return 0;
  return Math.min(1, Math.max(0, offset / travel));
}

export function slideConfirms(progress) {
  return progress >= SLIDE_CONFIRM_AT;
}

// Where a release leaves the thumb: at the end when it confirms, back at the start otherwise.
export function slideRelease(progress) {
  return slideConfirms(progress) ? 1 : 0;
}

// The next progress for a key, or null for a key the control does not take. Reaching the end by key confirms, the
// same as reaching it by drag.
export function slideKey(progress, key) {
  const p = Number(progress) || 0;
  if (key === 'ArrowRight' || key === 'ArrowUp') return Math.min(1, Math.round((p + SLIDE_KEY_STEP) * 10) / 10);
  if (key === 'ArrowLeft' || key === 'ArrowDown') return Math.max(0, Math.round((p - SLIDE_KEY_STEP) * 10) / 10);
  if (key === 'Home') return 0;
  if (key === 'End') return 1;
  return null;
}
