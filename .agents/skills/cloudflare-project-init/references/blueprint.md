# Cloudflare Next.js + Hono + Drizzle Blueprint

Use this reference when building or converting a single-package project to the Cloudflare split-runtime pattern: Next.js Pages Router static pages on Pages/CDN, Hono APIs on Workers.

## Directory Layout

Prefer this layout for new projects:

```text
my-project/
├── src/
│   ├── pages/
│   │   ├── _app.tsx
│   │   └── index.tsx
│   ├── components/
│   ├── lib/
│   ├── shared/
│   │   └── index.ts
│   └── worker/
│       ├── db/
│       │   └── schema.ts
│       ├── routes/
│       │   └── health.ts
│       └── index.ts
├── drizzle.config.ts
├── wrangler.jsonc
├── next.config.ts
├── components.json
└── package.json
```

Use this single package as the default. Only introduce pnpm workspaces if the existing repo already uses them or the user explicitly asks for a monorepo.

## Package Scripts

Merge these scripts and dependencies into the same `package.json` that Next.js uses.

```json
{
  "private": true,
  "packageManager": "pnpm@10.0.0",
  "type": "module",
  "scripts": {
    "dev": "concurrently -k -n web,worker \"pnpm dev:web\" \"pnpm dev:worker\"",
    "dev:web": "next dev",
    "dev:worker": "wrangler dev --local --port 8787",
    "build": "next build",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "deploy:web": "pnpm build",
    "deploy:worker": "wrangler deploy",
    "db:generate": "drizzle-kit generate",
    "db:migrate:local": "wrangler d1 migrations apply my-app-db --local",
    "db:migrate:prod": "wrangler d1 migrations apply my-app-db --remote"
  },
  "dependencies": {
    "@hono/zod-validator": "latest",
    "drizzle-orm": "latest",
    "hono": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "latest",
    "concurrently": "latest",
    "drizzle-kit": "latest",
    "wrangler": "latest"
  }
}
```

Keep the Next.js, React, Tailwind, ESLint, and shadcn dependencies created by `create-next-app` or already present in the repo.

## Scaffold Commands

For a fresh repo:

```bash
pnpm create next-app@latest . --ts --src-dir --tailwind --eslint --use-pnpm
mkdir -p src/worker/routes src/worker/db src/shared
pnpm add hono drizzle-orm zod @hono/zod-validator
pnpm add -D wrangler @cloudflare/workers-types drizzle-kit concurrently
pnpm dlx shadcn@latest init
```

When `create-next-app` asks whether to use the App Router, choose **No** so the project uses the Pages Router. When commands ask other interactive questions, choose the options that match the repo's Tailwind, alias, and style conventions. If `components.json` already exists, add components with the existing shadcn setup instead of running init again.

## Next.js Static Export

```ts
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true
  },
  trailingSlash: true
};

export default nextConfig;
```

Use a browser-visible API base for Worker calls:

```env
# .env.local
NEXT_PUBLIC_API_BASE_URL=http://localhost:8787
```

```tsx
// src/lib/api.ts
const fallbackApiBase = "http://localhost:8787";

export function apiUrl(path: string) {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? fallbackApiBase;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
```

Example Pages Router page:

```tsx
import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api";

export default function HomePage() {
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    fetch(apiUrl("/api/health"))
      .then((res) => res.json())
      .then((data) => setStatus(data.ok ? "ok" : "error"))
      .catch(() => setStatus("error"));
  }, []);

  return (
    <main>
      <span>{status}</span>
    </main>
  );
}
```

## Hono Worker

Keep Worker code under `src/worker` so it is clearly separate from the Next.js app while still living in the same package. Avoid importing React, Next.js, or shadcn code from this directory.

```jsonc
// wrangler.jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "my-app-api",
  "main": "src/worker/index.ts",
  "compatibility_date": "2026-05-01",
  "vars": {
    "APP_ENV": "production"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "my-app-db",
      "database_id": "replace-with-d1-database-id"
    }
  ],
  "routes": [
    { "pattern": "example.com/api/*", "zone_name": "example.com" }
  ]
}
```

Use a narrow API route and do not shadow the whole Pages site. Remove `routes` for local-only experiments or Workers preview deployments that do not use a zone route yet.

Create D1 before filling `database_id`:

```bash
pnpm wrangler d1 create my-app-db
```

Worker entry:

```ts
// src/worker/index.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { D1Database } from "@cloudflare/workers-types";
import { healthRoute } from "./routes/health";

type Bindings = {
  DB: D1Database;
  APP_ENV: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: [
      "http://localhost:3000",
      "https://your-project.pages.dev",
      "https://your-domain.com"
    ],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"]
  })
);

app.route("/api", healthRoute);

app.onError((err, c) => {
  console.error(`${c.req.method} ${c.req.url}`, err);
  return c.json({ error: "Internal Server Error" }, 500);
});

export default app;
```

Health route:

```ts
// src/worker/routes/health.ts
import { Hono } from "hono";

export const healthRoute = new Hono();

healthRoute.get("/health", (c) => {
  return c.json({ ok: true });
});
```

## Drizzle With D1

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/worker/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite"
});
```

```ts
// src/worker/db/schema.ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const counters = sqliteTable("counters", {
  key: text("key").primaryKey(),
  value: integer("value").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull()
});
```

Example route using Drizzle:

```ts
// src/worker/routes/count.ts
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import type { D1Database } from "@cloudflare/workers-types";
import { counters } from "../db/schema";

type Bindings = {
  DB: D1Database;
};

export const countRoute = new Hono<{ Bindings: Bindings }>();

countRoute.get("/count", async (c) => {
  const db = drizzle(c.env.DB);
  const [row] = await db
    .select({ value: counters.value })
    .from(counters)
    .where(eq(counters.key, "global"))
    .limit(1);

  return c.json({ count: row?.value ?? 0 });
});

countRoute.post("/count", async (c) => {
  const db = drizzle(c.env.DB);
  const now = new Date();

  await db
    .insert(counters)
    .values({ key: "global", value: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: counters.key,
      set: {
        value: sql`${counters.value} + 1`,
        updatedAt: now
      }
    });

  const [row] = await db
    .select({ value: counters.value })
    .from(counters)
    .where(eq(counters.key, "global"))
    .limit(1);

  return c.json({ count: row?.value ?? 1 });
});
```

Mount the route in `index.ts`:

```ts
import { countRoute } from "./routes/count";

app.route("/api", countRoute);
```

Generate and apply migrations:

```bash
pnpm db:generate
pnpm db:migrate:local
pnpm db:migrate:prod
```

## Cloudflare Deployment Notes

- Pages build command: `pnpm build`
- Pages output directory: `out`
- Worker deploy command: `pnpm deploy:worker`
- Worker route pattern: only `your-domain.com/api/*` or equivalent.
- Set `NEXT_PUBLIC_API_BASE_URL` in Pages environment variables to the deployed Worker/API origin.
- Put Worker secrets in Cloudflare dashboard or `wrangler secret put`; do not expose them to Next.js static output.

## Common Pitfalls

- Workers CPU time is limited; avoid request-time React rendering, large JSON transforms, image processing, and HTML rendering in the Worker.
- Cloudflare Pages and Next.js `trailingSlash: true` can conflict with Pages trailing slash redirects; check Pages settings after deploy.
- Worker routes have priority over Pages. If a Worker route returns 404, Cloudflare will not fall back to static assets.
- KV is eventually consistent. Use D1 for balances, inventory, user-owned records, and write-after-read expectations.
- Static exported Next.js Pages Router cannot use `getServerSideProps`, ISR, or API Routes for deployed dynamic behavior. Move dynamic behavior to the Hono API and fetch from the browser.
