# Contributing

## The loop

- `pnpm install`, then `pnpm run hooks:install` once, so lint runs before each commit and the tests before each push.
- `pnpm run lint`, `pnpm run test` and `pnpm run build` must pass. `pnpm run smoke` boots the desktop app against a fake server; it needs a display.
- Every change lands as a pull request and merges when CI is green. Commits follow Conventional Commits, and the message says why.

## The rules, and the test that holds each

- A value several places must agree on lives in one spec under `core/spec/`, and the rest read it (`core/test/guards.test.js`).
- Code never carries the product's name; it reads `core/spec/naming.json` ("the product name lives only where naming.json says").
- Framework code in `core/kit/` imports only from the kit ("framework code in core/kit imports only from core/kit").
- Modules under `rules/` do no I/O and read no clock ("rule modules do no I/O").
- Every custom element is defined in core ("every custom element is defined in core").
- Component CSS takes every colour and length from the tokens ("component CSS carries no literal colours or lengths").
- Every log event and field is declared in `core/spec/log-events.json`, and nothing private is logged (the strict logger in the server's tests, and the leak test).
- Fixtures and captures hold synthetic data only (`server/test/fixtures.test.js`).
- No em dashes, in code, docs or commit messages ("no em dash anywhere in the repository").
