import { loadConfig } from '../config.js';

export default {
  name: 'check',
  async run({ dataDir, flags, die }) {
    const url = typeof flags.url === 'string' ? flags.url : 'http://127.0.0.1:' + loadConfig(dataDir).port;
    let u = null;
    try {
      u = new URL(url);
    } catch {
      die('--url must be a URL such as https://host');
    }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.search || u.hash) {
      die('--url is http or https with no credentials, query or fragment: the token goes on stdin');
    }
    if (process.stdin.isTTY) die('pipe a token on standard input; it never goes in a URL or an argument');
    // Read as a stream, never readFileSync(0): on macOS a pipe whose writer has not written yet answers EAGAIN, which
    // is exactly the case of a password manager's CLI piped in.
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const token = Buffer.concat(chunks).toString('utf8').split('\n')[0].trim();
    if (!token) die('no token on standard input');
    const { check } = await import('../service.js');
    return (await check({ url: u.origin + u.pathname, token })) ? 0 : 1;
  },
};
