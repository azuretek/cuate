import { html } from './lit.js';
import { actionLabels } from './rules/button.js';

// One shared action button for the kit (issue 190). Every standalone action button in the app wears the class
// `button action-button`, goes through the one kit press (core/kit/press.js, which owns the pending
// state and the debounce), and draws its words through here:
//
//   <button class="button action-button" @click=${press(() => this.save())}>
//     ${actionButtonLabels({ idle: 'Save', pending: 'Saving', success: 'Saved', failure: 'Could not save' })}
//   </button>
//
// Every label is drawn up front in ONE grid box (the stylesheet's .action-labels / .action-label rules), so the
// button is as wide as its widest state and the row never jumps; the stylesheet shows the one matching the press's
// own data-press, so the button keeps no second copy of its state. Source: #190.
export function actionButtonLabels({ idle, pending, success, failure } = {}) {
  const labels = actionLabels({ idle, pending, success, failure });
  return html`<span class="action-labels">${labels.map((label) => html`<span class="action-label" data-when=${label.state}>${label.text}</span>`)}</span>`;
}
