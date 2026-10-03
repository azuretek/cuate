export default {
  id: 'info',
  handle({ res, json, naming, apiSpec, serverVersion, serverChannel, serverBuild, serverCommit, serverBuiltAt, platform, epoch, engine, config, updateOutcome }) {
    json(res, 200, {
      product: naming.product,
      // Where the source lives, so About can link to it, its licence and its issues without the page carrying a name.
      repository: 'https://github.com/' + naming.repo,
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
