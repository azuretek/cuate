// Pure: what the app says about its connection to the server, one sentence per state.
const SENTENCES = {
  connecting: 'Connecting to your server\u2026',
  open: '',
  reconnecting: 'Reconnecting to your server\u2026',
  closed: 'Disconnected from your server.',
  unauthorized: "The server no longer accepts this device's token.",
  unreachable: 'The server did not answer. Check the address, and that the server is running.',
  'version-mismatch': 'This server speaks a different version of the API. Update the app or the server.',
};

export function connectionSentence(state) {
  return SENTENCES[state] ?? '';
}
