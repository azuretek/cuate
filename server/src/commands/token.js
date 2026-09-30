import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCOPES } from '../store.js';

export default {
  name: 'token',
  async run({ pos, sub, flags, handoff, die, store }) {
    const s = store();
    if (sub === 'create') {
      const scope = String(flags.scope || 'device');
      if (!SCOPES.includes(scope)) die('scope must be one of ' + SCOPES.join(', '));
      const name = String(flags.name || scope);
      if (handoff && !handoff.length) die('-- needs a command after it');
      const { id, token } = s.createToken(scope, name);
      if (handoff) {
        const { fillHandoff } = await import('../service.js');
        // The token goes to the command's stdin, never into an argument, a log or this output.
        const r = spawnSync(handoff[0], fillHandoff(handoff.slice(1), { id, scope, name }), { input: token + '\n', stdio: ['pipe', 'inherit', 'inherit'] });
        if (r.error || r.status !== 0) {
          const revoked = s.revokeToken(id);
          s.close();
          die('the command ' + path.basename(handoff[0]) + ' failed (' + (r.error ? r.error.message : 'exit ' + r.status) + '), so token ' + id + (revoked ? ' was revoked' : ' was NOT revoked: run token revoke ' + id));
        }
        console.log('token ' + id + ' (' + scope + ') for ' + name + ' was handed to ' + path.basename(handoff[0]) + ' and not printed');
      } else {
        console.log('token ' + id + ' (' + scope + ') for ' + name + '. It is shown once; store it now:');
        console.log(token);
      }
    } else if (sub === 'list') {
      for (const t of s.listTokens()) console.log([t.id, t.scope, t.revoked_at ? 'revoked' : 'active', t.name, 'created ' + t.created_at, t.last_used_at ? 'last used ' + t.last_used_at : 'never used'].join('  '));
    } else if (sub === 'revoke') {
      console.log(s.revokeToken(pos[2]) ? 'revoked ' + pos[2] : 'no active token ' + pos[2]);
    } else {
      die('usage: token create|list|revoke');
    }
    s.close();
  },
};
