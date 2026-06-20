---
name: cloudflare-project-init
description: Initialize and standardize single-package Cloudflare-oriented full-stack projects using TypeScript, Next.js Pages Router static pages, React, shadcn/ui, Hono Workers APIs, Drizzle, D1/KV, Wrangler JSONC config, and pnpm. Use when Codex is asked to scaffold, bootstrap, migrate, or configure a Cloudflare project; keep frontend pages and Worker backend in one package; split static frontend delivery from Worker APIs; avoid running Next.js RSC/SSR inside Workers; use wrangler.jsonc; or set up Pages, Workers, Hono, shadcn, Drizzle, and pnpm together.
---

# Cloudflare Project Init

## Operating Model

Use this skill to create a Cloudflare project where static UI and dynamic APIs are deliberately separated:

- Serve Next.js Pages Router pages as a static export from Cloudflare Pages/CDN.
- Serve `/api/*` from a Cloudflare Worker using Hono.
- Use React and shadcn/ui in the Next.js app.
- Use Drizzle with D1 for relational or strongly consistent data.
- Use KV only for cache-like or eventually consistent data.
- Keep web and Worker source in one pnpm package by default.

Do not put React, Next.js runtime, RSC rendering, SSR, or API Routes in the Worker unless the user explicitly asks for a different deployment model. If the product truly needs SSR/ISR/RSC at request time, explain the CPU/runtime tradeoff and consider `@cloudflare/next-on-pages` or another host instead of forcing this pattern.

## Workflow

1. Inspect the existing repo first:
   - Read `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `next.config.*`, `wrangler.jsonc`, `drizzle.config.*`, `components.json`, and `tsconfig*` if present. Read an existing `wrangler.toml` only to preserve settings while migrating it to `wrangler.jsonc`.
   - Preserve existing naming, aliases, lint rules, Tailwind setup, and app structure when possible.
   - If there is already a `components.json`, follow the local shadcn setup instead of reinitializing it.

2. Choose the layout:
   - For a new project, keep Next.js and Hono Worker in the same package.
   - Use `src/pages` and `src/components` for the Next.js Pages Router app.
   - Use `src/worker` for the Hono Worker, with `src/worker/routes` and `src/worker/db`.
   - Use `src/shared` only for pure types and utilities that both browser and Worker code can safely import.
   - Avoid `src/pages/api` in the Next.js app for this pattern.

3. Configure the Next.js app:
   - Set `output: "export"` in `next.config.ts`.
   - Set `images.unoptimized: true` unless the project has a separate image optimization service.
   - Prefer `trailingSlash: true` for Pages static export, then check Cloudflare Pages trailing slash settings to avoid redirect loops.
   - Fetch dynamic data from the Worker with a public API base such as `NEXT_PUBLIC_API_BASE_URL`.
   - Keep pages client-safe when they depend on live data; use client components or static pages that fetch after hydration.

4. Configure the Hono Worker:
   - Keep the Worker focused on lightweight API handlers, validation, auth, D1/KV access, webhook handling, and third-party API calls.
   - Type Cloudflare bindings explicitly with Hono generics.
   - Mount routes under `/api`.
   - Add CORS for local dev and production Pages domains. Do not use wildcard CORS with credentials.
   - Add `app.onError` and a small health route.
   - Ensure Worker routes only match API paths; a Worker 404 will not fall back to Pages.
   - Use `wrangler.jsonc` for Wrangler config when creating or replacing configuration.

5. Configure Drizzle and storage:
   - Use D1 plus `drizzle-orm/d1` for app data, counters, inventory, billing state, and anything needing SQL semantics.
   - Use KV for configuration, feature flags, cached responses, counters where eventual consistency is acceptable, or simple key-value reads.
   - Generate migrations with Drizzle Kit and apply them through Wrangler D1 commands.
   - Keep generated migrations committed.

6. Configure scripts and local development:
   - Use package scripts such as `dev:web`, `dev:worker`, and `dev` to run Next.js and Wrangler together.
   - Default ports: web on `3000`, Worker on `8787`.
   - Use `.dev.vars` for local Worker secrets; do not commit real secrets.
   - Use one package-level `package.json` for `dev`, `build`, `typecheck`, `lint`, and deployment wrappers.

7. Deploy:
   - Deploy `out` to Cloudflare Pages.
   - Deploy the Worker from the same package with Wrangler.
   - Configure Pages build command to run the package build.
   - Configure Worker route patterns only for `/api/*`.

## Templates

Read `references/blueprint.md` when creating or editing files. It contains a concrete single-package layout, Next.js static export config, Hono Worker skeleton, D1/Drizzle setup, route examples, package scripts, and validation checklist.

## Validation

Before finishing, verify the result with the checks that fit the repo:

- `pnpm install` if dependencies changed.
- `pnpm typecheck` or package-specific TypeScript checks.
- `pnpm lint` if configured.
- `pnpm build` for the Next.js static export.
- `pnpm wrangler types` if Worker bindings changed.
- `pnpm dev:worker` or a local request to `/api/health` if practical.

Also inspect for architecture regressions:

- The Worker imports no `next`, `react`, or UI code.
- The web app has no Pages Router API Routes for Cloudflare-owned endpoints.
- The Worker route pattern cannot shadow static Pages routes.
- Drizzle migrations and schema agree.
- Public browser env vars use `NEXT_PUBLIC_`; secrets stay in Worker bindings or Cloudflare secrets.
