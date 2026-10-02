export default {
  id: 'health',
  // The version and commit are the stamp's, so an updater can tell, without a token, that the server answering is the
  // one it just switched to.
  handle({ res, json, serverVersion, serverCommit }) {
    json(res, 200, { ok: true, version: serverVersion, commit: serverCommit });
  },
};
