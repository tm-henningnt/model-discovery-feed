# model-discovery-feed

This repository is a Next.js + Prisma example implementation of the Model Discovery Feed contract.

It shows how to publish a provider-agnostic model discovery feed, validate fixtures, and expose the contract over HTTP.

It is not:

- an inference proxy;
- a model router;
- a provider credential store.

## Quick start

```bash
npm ci
npm run validate:fixture
npm test
npm run typecheck
npm run build
npm run dev
```

## Endpoints

- `GET /v1/schema`
- `GET /v1/feed`
- `GET /v1/status`
- `GET /v1/models` — supports `?profile=` for a named delegation profile (`best-coder`, `best-agentic`, `best-value-coder`, `best-free-coder`) alongside the usual additive filters
- `GET /v1/models/{id}`
- `GET /v1/providers`

## Public docs

- [Feed contract, endpoints, CLI usage, and adapter boundaries](docs/public/model-discovery-feed.md)
- [Client integration guide](docs/public/client-integration-guide.md)
- [Fixture examples](docs/public/fixtures/)
- [Deployment guide](docs/deployment.md)

## CLI example

```bash
npm run model-feed -- list --feed https://example.com/v1/feed --capability coding --json
npm run model-feed -- list --feed https://example.com/v1/feed --profile best-coder --json
```

The explorer's Export drawer also ships built-in export presets for each delegation profile,
rendering the current selection as a ready-to-paste Markdown delegation table.

## Security

Do not commit real `.env` files. Use `.env.example` for local setup and keep secrets out of `NEXT_PUBLIC_*` variables.
