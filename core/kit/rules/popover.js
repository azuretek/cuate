// Pure: where a popover's caret points (issue 217). A caret is a small triangle on a popover's edge, aimed at the
// control that opened it, so the menu reads as belonging to that control rather than to the page. This is only the
// geometry. Given the control's box and the popover's own box, it answers the caret's centre in the popover's x
// coordinate, or null when the control is not over the popover at all, which is an untargeted caret and what the
// guard fails on.

// Half the caret's own width, so the triangle is kept whole and never overhangs a popover's corner. The caret is 10px
// (tokens size.caret), so this is half of it, a hair over.
const INSET = 6;

// align: 'center' aims at the control's middle; 'start' and 'end' aim at its near edge, which is what a control wider
// than the popover (a message bubble under its menu) needs so the caret still sits on the popover.
export function caretX(anchor, box, align = 'center') {
  if (!anchor || !box || !(box.width > 0)) return null;
  if (anchor.right <= box.left || anchor.left >= box.right) return null;
  const raw = align === 'start' ? anchor.left + INSET
    : align === 'end' ? anchor.right - INSET
      : anchor.left + anchor.width / 2;
  const min = Math.min(INSET, box.width / 2);
  const max = Math.max(box.width - INSET, box.width / 2);
  return Math.round(Math.min(Math.max(raw - box.left, min), max));
}
