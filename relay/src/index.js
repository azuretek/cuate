// The deployed function (issue 347). It runs as the project's own service account, so Firebase is reached with
// Google's own credentials and no key file exists anywhere. The ticket secret is a Secret Manager secret only this
// function reads. maxInstances caps how many copies can run at once, which bounds what a flood of calls can cost.
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { createHandler } from './handler.js';

const TICKET_SECRET = defineSecret('RELAY_TICKET_SECRET');
initializeApp();

let handle = null;

export const relay = onRequest({ maxInstances: 2, concurrency: 80, memory: '256MiB', timeoutSeconds: 15, secrets: [TICKET_SECRET], invoker: 'public' }, async (req, res) => {
  handle ||= createHandler({
    secret: TICKET_SECRET.value(),
    send: (message, dryRun) => getMessaging().send(message, dryRun),
    log: (event, fields) => logger.info(event, fields),
  });
  const out = await handle({ method: req.method, path: req.path, ip: req.ip, body: req.body });
  res.status(out.status).json(out.body);
});
