// The Mac the server drives, for the Server screen: what is held and configured, and whether Messages is up.
export default {
  id: 'mac',
  async handle({ res, json, mac }) {
    if (!mac) return json(res, 503, { error: { code: 'mac_unavailable', message: 'The server is not looking after the Mac in this run.' } });
    const s = mac.state();
    json(res, 200, {
      awake: s.awake,
      locked: s.locked,
      lockEnabled: s.lockEnabled,
      lockMethod: s.lockMethod,
      messagesRunning: Boolean(await mac.messagesRunning()),
      managedBy: s.managedBy,
    });
  },
};
