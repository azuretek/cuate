// A phone stops getting push notifications (issue 347), as when it signs out or the person turns them off.
export default {
  id: 'push-unregister',
  async handle({ res, json, push, principal }) {
    push.unregister(principal.id);
    return json(res, 200, { registered: false });
  },
};
