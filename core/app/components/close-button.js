import { html, nothing } from '../../kit/lit.js';
import { press } from '../../kit/press.js';

// The one close (X) control (issue 213). The image viewer, the thread card and every notice draw their X here and
// nowhere else, so each one has the same hit area: the whole button, a square whose inscribed circle is the drawn
// control, sized from a token at every window size. It is marked no-drag itself, so on a frameless desktop window no
// header's drag strip can take a press on it, wherever the surface that holds it sits; core/test/guards.test.js holds
// that every close control in core/app is this one, and the desktop smoke (smoke:closeControls) clicks each one at its
// centre and near each edge of its circle at several window sizes.
//
// - owner names the surface it closes (viewer, thread, notice), for the stylesheet and the smoke;
// - size is 'md' (the default) or 'lg', the raised circle the image viewer floats over a picture;
// - keep is a dismiss panel name the press leaves to this control's own click (data-dismiss-keep).
export function closeButtonHtml({ owner, label, title, size = 'md', keep, onClose }) {
  return html`<button type="button" class="close-button" data-close="${owner}" data-size="${size}" aria-label="${label}" title="${title || label}" data-dismiss-keep=${keep || nothing} @click=${press(() => onClose())}><span class="icon" data-icon="x" aria-hidden="true"></span></button>`;
}
