# Deployment

This project is deployable as a Next.js app on Vercel with Prisma Postgres for persistence and GitHub Actions for the daily collector refresh.

## Vercel

Configure these environment variables for Production:

- `DATABASE_URL`: Prisma Postgres pooled connection string.
- `MODEL_FEED_USE_DATABASE=true`: serve the latest published `FeedRelease` instead of the static fixture.
- `MODEL_FEED_API_KEY_SHA256`: optional SHA-256 hex digest for the bearer token required by the API.

Do not put secrets in `NEXT_PUBLIC_*` variables.

## Prisma Postgres

Use the pooled connection string for runtime app traffic.

The Prisma GitHub integration can own schema application when a project uses it. In that setup, the scheduled refresh workflow does not need to run `prisma migrate deploy`; it only generates the Prisma Client and publishes a new feed release.

Keep a direct connection string available for local/manual Prisma operations. If a project does not use Prisma's GitHub integration, run `npx prisma migrate deploy` in CI with a direct database URL.

## Daily refresh

`.github/workflows/refresh-model-feed.yml` runs once per day at `03:17` UTC and can also be started manually with `workflow_dispatch`.

Example GitHub Actions secrets:

- `DATABASE_URL`
- `OPENROUTER_API_KEY`
- `GROQ_API_KEY`
- `GEMINI_API_KEY`
- `GH_MODELS_TOKEN` (GitHub Actions rejects secret names starting with `GITHUB_`)

The workflow runs:

```bash
npm ci
npx prisma generate
npm run collect -- --publish
```

The publish step writes collector runs, source snapshots, and a validated `published` feed release. Invalid candidate feeds are not published.
