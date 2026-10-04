// The one caret every popover wears (issue 217): a small triangle on a popover's edge, pointing at the control that
// opened it. A popover marks itself with data-popover and, because it already closes through the kit's outside-dismiss
// behaviour (core/kit/dismiss.js), the control that opened it is the one whose data-dismiss-keep names the popover and
// that is expanded while the popover is open. aimCarets() reads that pair, so a new menu gets its caret for free the
// moment it follows the dismiss conventions the guards already hold it to.
import { caretX } from './rules/popover.js';

// The control a popover answers: from the popover, the nearest ancestor whose own data-dismiss-keep names it and whose
// aria-expanded is true (a message row is its own control), or a descendant of an ancestor that carries both (the
// sidebar buttons are siblings in the header, the composer's buttons siblings in the form).
export function caretAnchor(pop) {
  const name = pop.dataset.dismiss;
  if (!name) return null;
  const matches = (el) => String(el.getAttribute('data-dismiss-keep') || '').split(/\s+/).includes(name) && el.getAttribute('aria-expanded') === 'true';
  for (let node = pop.parentElement; node; node = node.parentElement) {
    for (const el of node.querySelectorAll('[data-dismiss-keep][aria-expanded="true"]')) if (matches(el)) return el;
    if (matches(node)) return node;
  }
  return null;
}

// Aim every open popover in a host at its control, and answer each one's result so a caller (the smoke, a test) can
// hold the rule that a popover never opens without a caret, or with one that points nowhere.
export function aimCarets(host) {
  const out = [];
  for (const pop of host.querySelectorAll('[data-popover]')) {
    const anchor = caretAnchor(pop);
    const align = pop.dataset.popoverAlign || 'center';
    const x = anchor ? caretX(anchor.getBoundingClientRect(), pop.getBoundingClientRect(), align) : null;
    const name = pop.dataset.dismiss || pop.getAttribute('class') || 'popover';
    if (x === null) out.push({ name, ok: false });
    else { pop.style.setProperty('--caret-x', x + 'px'); out.push({ name, ok: true, x }); }
  }
  return out;
}
