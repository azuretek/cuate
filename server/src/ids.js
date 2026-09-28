import { createHmac } from 'node:crypto';

// Attachment ids are a keyed hash of the file's path, so the path never leaves the server; the store maps them back.
export function makeAttachmentId({ secret, store }) {
  return (a) => {
    const key = String(a.original_path || a.filename || a.transfer_name || '');
    const id = createHmac('sha256', secret).update(key).digest('base64url').slice(0, 22);
    if (a.original_path) store.putAttachment(id, String(a.original_path), String(a.mime_type || 'application/octet-stream'), String(a.transfer_name || a.filename || 'attachment'));
    return id;
  };
}
