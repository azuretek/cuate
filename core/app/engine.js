// The ENGINE entry: the whole of core a shell can run with no page on screen.
//
// The iOS shell evaluates this through JavaScriptCore and Android through its
// embedded engine, so every rule a shell needs lives here once and ships as one
// generated bundle (scripts/gen-engine-bundle.mjs) rather than as a Swift or
// Kotlin port of it. The modules below are pure: no I/O, no clock, no DOM, which
// is what makes the same answers possible on every engine.
export { createApiClient } from '../kit/api.js';
export { createLogger, LEVELS } from '../kit/log.js';
export { scrub } from '../kit/rules/scrub.js';
export { newTraceparent, formatTraceparent, parseTraceparent } from '../kit/rules/trace.js';
export { validate } from '../kit/rules/schema.js';
export { tokensCss } from '../kit/rules/tokens.js';
export * from './rules/chats.js';
export * from './rules/connection.js';
export * from './rules/engine-imsg.js';
export * from './rules/messages.js';
export * from './rules/notifications.js';
export * from './rules/settings.js';
export * from './rules/time.js';
