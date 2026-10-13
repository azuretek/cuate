// A phone registers for push notifications with the app closed (issue 347): its push token, its platform and the key
// the server seals each notification with. One registration per signed-in device; registering again replaces it.
import { readRegistration } from '../push.js';

export default {
  id: 'push-register',
  async handle({ req, res, json, badRequest, fail, readJson, push, principal }) {
    const reg = readRegistration(await readJson(req, 8192));
    if (reg.error) throw badRequest('bad_body', reg.error);
    const out = await push.register(principal.id, reg);
    if (out.status !== 200) return fail(res, out.status, out.code, out.code === 'push_off' ? 'Push notifications are switched off on this server.' : out.code === 'token_gone' ? 'That push token no longer reaches a phone.' : 'The push relay did not accept the phone.');
    return json(res, 200, { registered: true });
  },
};
