# WealthPulse Backend

Node.js 20.12+ · TypeScript (strict) · Express 4 · PostgreSQL 15 + Drizzle ORM (`postgres` driver) · Redis 7 · Socket.io · Bull · Zod · JWT + bcryptjs · yahoo-finance2 · Jest + Supertest.

Code lives at the repo root (`src/`). Detailed conventions are in `.claude/rules/` (loaded automatically, some only for matching paths).

## Commands (run from repo root)

```bash
npm run dev          # tsx watch src/server.ts
npm run build        # tsc
npm run lint         # eslint
npm run type-check   # tsc --noEmit
npm test             # jest
npx drizzle-kit generate   # create migration from schema.ts
npx drizzle-kit migrate    # apply migrations
docker compose up -d postgres redis
```

## Layering (never skip a layer)

Feature folders: `src/routes/<feature>/{<feature>Routes,<feature>Controller,<feature>Service,<feature>Repository}.ts`, mounted in `src/routes/index.ts`.

`<feature>Routes` → `middleware/` (auth) → `<feature>Controller` (Zod validation, req/res formatting, camelCase response) → `<feature>Service` (business logic, cache) → `<feature>Repository` (DB queries) → `db/schema.ts`. Every controller/service/repository function uses try/catch and throws `AppError` with the right status (see `.claude/rules/architecture.md`).

## Hard rules

- Every user-owned query filters by `userId` — no exceptions (IDOR).
- Money/quantities are `numeric` in Postgres and never JS float math for totals.
- Secrets only via `src/config/env.ts` (zod-parsed `process.env`); never read `process.env` elsewhere.
- Mutations invalidate their cache keys (see `.claude/rules/caching.md`).
- Don't add a dependency the plan doesn't list without asking.

## Agents & skills

- Agents (`.claude/agents/`): `api-builder`, `db-architect`, `test-writer`, `security-reviewer`
- Skills (`.claude/skills/`): `/new-endpoint`, `/db-migration`, `/background-job`, `/socket-event`
