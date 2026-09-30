import path from 'node:path';

export default {
  name: 'backup',
  async run({ dataDir, flags, die }) {
    const out = typeof flags.out === 'string' ? path.resolve(flags.out) : null;
    if (!out) die('backup needs --out FILE');
    const { backupDataDir } = await import('../backup.js');
    const r = await backupDataDir({ dataDir, out });
    console.log('wrote ' + r.file + ' (' + r.bytes + ' bytes, ' + r.names.length + ' files)');
    return 0;
  },
};
