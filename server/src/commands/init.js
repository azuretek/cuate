import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { configPath, normalizeConfig, saveConfig } from '../config.js';

export default {
  name: 'init',
  async run({ dataDir, flags, store }) {
    if (existsSync(configPath(dataDir)) && !flags.force) {
      console.log('already initialised: ' + dataDir);
      return;
    }
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const config = normalizeConfig({
      port: flags.port !== undefined ? Number(flags.port) : undefined,
      engine: { kind: typeof flags.engine === 'string' ? flags.engine : 'imsg', ...(typeof flags.bin === 'string' ? { bin: flags.bin } : {}), ...(typeof flags.db === 'string' ? { db: flags.db } : {}) },
    });
    saveConfig(dataDir, config);
    const secret = path.join(dataDir, 'secret');
    if (!existsSync(secret)) writeFileSync(secret, randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
    store().close();
    console.log('initialised ' + dataDir + ' (engine ' + config.engine.kind + ', port ' + config.port + ', sending off)');
    console.log('next: token create --scope device --name <device>, then doctor, then run');
  },
};
