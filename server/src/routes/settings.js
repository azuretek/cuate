export default {
  id: 'settings',
  handle({ res, json, settings }) {
    json(res, 200, { values: settings.all() });
  },
};
