import { html } from '../../kit/lit.js';
import { press } from '../../kit/press.js';

// The window controls the contact header draws on Windows and Linux: the min, max and close glyphs in currentColor so a
// control follows the theme like every other mark, with the middle button showing the restore glyph when the window is
// maximised. The glyphs carry no size or stroke weight of their own: both are tokens the stylesheet applies, so light,
// dark and a theme draw them alike. The order, and which platform draws them at all, is core/app/rules/bar-layout.js;
// each click goes back to the page, which asks the shell for its own action.
const ICON_MINIMIZE = html`<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" fill="none" stroke="currentColor"></path></svg>`;
const ICON_MAXIMIZE = html`<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor"></rect></svg>`;
const ICON_RESTORE = html`<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 2.5V0.5h7v7h-2" fill="none" stroke="currentColor"></path><rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor"></rect></svg>`;
const ICON_CLOSE = html`<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" fill="none" stroke="currentColor"></path></svg>`;

export function windowControlsHtml({ order, maximized, onAction }) {
  const labelOf = (name) => (name === 'maximize' ? (maximized ? 'Restore' : 'Maximize') : name === 'minimize' ? 'Minimize' : 'Close');
  const glyphOf = (name) => (name === 'minimize' ? ICON_MINIMIZE : name === 'maximize' ? (maximized ? ICON_RESTORE : ICON_MAXIMIZE) : ICON_CLOSE);
  return html`<div class="window-controls" role="group" aria-label="Window controls">${order.map((name) => html`<button type="button" class="window-control ${name}" aria-label=${labelOf(name)} title=${labelOf(name)} @click=${press(() => onAction(name))}>${glyphOf(name)}</button>`)}</div>`;
}
