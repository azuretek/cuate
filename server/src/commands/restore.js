import path from 'node:path';

export default {
  name: 'restore',
  async run({ dataDir, flags, die }) {
    const file = typeof flags.file === 'string' ? path.resolve(flags.file) : null;
    if (!file) die('restore needs --file BACKUP');
    const { restoreDataDir } = await import('../backup.js');
    const r = restoreDataDir({ file, dataDir, force: flags.force === true });
    console.log('restored ' + r.names.length + ' files into ' + r.dataDir);
    return 0;
  },
};
