import { loadConfig } from '../config.js';

export default {
  name: 'doctor',
  async run({ dataDir, doctorReport }) {
    const r = await doctorReport(loadConfig(dataDir));
    console.log(r.lines.join('\n'));
    return r.failed ? 1 : 0;
  },
};
