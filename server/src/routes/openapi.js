// The OpenAPI document, generated from core/spec/api.json and served unchanged, so a tool can read the same
// description of the API the server enforces rather than a second copy.
import { openapiDocument } from '../../../core/kit/rules/openapi.js';

export default {
  id: 'openapi',
  handle({ res, json, apiSpec, naming }) {
    json(res, 200, openapiDocument(apiSpec, naming));
  },
};
