export default {
  id: 'emoji-favourites',
  handle({ res, json, emoji }) {
    json(res, 200, { favourites: emoji.all() });
  },
};
