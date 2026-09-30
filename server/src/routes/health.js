export default {
  id: 'health',
  handle({ res, json }) {
    json(res, 200, { ok: true });
  },
};
