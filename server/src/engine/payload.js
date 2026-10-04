// The bytes of a message's own plugin payload are the only word for what it is: Messages records these with an empty
// type, so a link preview's still or an app's icon arrives unnamed. Read a little of the file and let the signature
// speak. Pure apart from the injected reader, so it is tested without a disk.
import { isPayloadName } from '../../../core/app/rules/payload.js';
import { sniff } from '../file-type.js';

export function annotatePayloads(message, readHead) {
  const list = Array.isArray(message && message.attachments) ? message.attachments : [];
  if (!list.length) return message;
  let changed = false;
  const attachments = list.map((a) => {
    const name = String(a.transfer_name || a.filename || '');
    if (!isPayloadName(name) || String(a.mime_type || '')) return a;
    const head = readHead ? readHead(a) : null;
    const mime = head ? sniff(head) : null;
    if (!mime) return a;
    changed = true;
    return { ...a, mime_type: mime };
  });
  return changed ? { ...message, attachments } : message;
}
