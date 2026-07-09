# Contributing

## Setup and Verification

Run the project checks in this order:

```bash
npm ci
npm run validate:fixture
npm test
npm run typecheck
npm run build
```

## Coding Conventions

- Use strict TypeScript.
- Validate runtime input and output with Zod.
- Keep tests under `src/**/*.test.ts`.
- Keep fixtures under `docs/public/fixtures/`.

## Documentation

Public client docs must remain provider/client-agnostic unless they are explicitly marked non-normative.

## Secret Handling

Never commit `.env`, `.env.local`, real database URLs, or provider keys.
