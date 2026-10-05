// Pure: the words a standalone action button shows in each of its states, and the one box it keeps (issue 190).
// core/kit/button.js draws them; core/app/styles/app.css is what makes them one box; core/kit/press.js owns the
// state itself (idle, pending, the outcome) and the debounce. This module decides the words, so it is tested directly
// and answers the same for every button.
//
// A button can show its own words in each state: what it says at rest, what it says while it works, what it says when
// the work is done and what it says when the work failed. A state with no words of its own keeps the button's own
// rest words, so a state never leaves the button blank. Source: #190.
export const ACTION_STATES = ['idle', 'pending', 'success', 'failure'];

// The words a state shows: its own where it has them, else the button's own rest words.
export function actionLabel(labels = {}, state) {
  const idle = labels.idle || '';
  if (state === 'idle') return idle;
  return labels[state] || idle;
}

// Every label a button can show, one per state, the rest words first. They are drawn in ONE box, so the button is as
// wide as the widest words it can show in any state and never resizes as its state changes.
export function actionLabels(labels = {}) {
  return ACTION_STATES.map((state) => ({ state, text: actionLabel(labels, state) }));
}

// The state to draw for a control, given the kit press's own attribute: no attribute is idle, and only a declared
// state is drawn.
export function actionStateOf(press) {
  return ACTION_STATES.includes(press) ? press : 'idle';
}
