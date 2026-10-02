// The about sheet must not scroll sideways, and its card must track its content rather than fill a fixed sheet.
// See lib/sheet-probe.mjs. Run it with a display:
//
//   xvfb-run -a npx electron desktop/scripts/prove-about-overflow.mjs
import { proveSheet } from './lib/sheet-probe.mjs';

await proveSheet('about');
