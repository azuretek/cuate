export default {
  id: 'info',
  handle({ res, json, naming, apiSpec, serverVersion, serverChannel, serverBuild, serverCommit, serverBuiltAt, platform, epoch, engine, config, updateOutcome }) {
    json(res, 200, {
      product: naming.product,
      apiVersion: apiSpec.version,
      serverVersion,
      serverChannel,
      serverBuild,
      serverCommit,
      serverBuiltAt,
      serverPlatform: platform,
      epoch,
      engine: engine.info(),
      sending: config.sending.enabled,
      uploadMaxBytes: apiSpec.uploads.maxBytes,
      serverUpdate: updateOutcome ? updateOutcome() : null,
    });
  },
};
