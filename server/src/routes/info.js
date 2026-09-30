export default {
  id: 'info',
  handle({ res, json, naming, apiSpec, serverVersion, epoch, engine, config }) {
    json(res, 200, { product: naming.product, apiVersion: apiSpec.version, serverVersion, epoch, engine: engine.info(), sending: config.sending.enabled });
  },
};
