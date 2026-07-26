#!/usr/bin/env node
/**
 * daily_store.mjs — domain CLI over the daily-news SQLite store.
 *
 * Machine-readable JSON goes to stdout; everything else to stderr.
 * There is no generic table CRUD here on purpose: agents get only the
 * operations their stage owns, and store.mjs rejects out-of-stage writes.
 *
 * Usage (from repo root):
 *   node .../daily_store.mjs migrate
 *   node .../daily_store.mjs sites sync|list [--enabled]
 *   node .../daily_store.mjs run start --date YYYYMMDD | run get --run N | run finish --run N
 *   node .../daily_store.mjs stage set --run N --stage list --status running
 *   node .../daily_store.mjs list import --run N --site v2ex --file list.json
 *   node .../daily_store.mjs candidates export --run N [--site v2ex]
 *   node .../daily_store.mjs selections save --run N --file sel.json
 *   node .../daily_store.mjs selections export --run N [--site v2ex]
 *   node .../daily_store.mjs article import --run N --site v2ex --file deep.json
 *   node .../daily_store.mjs evidence save --run N --file ev.json
 *   node .../daily_store.mjs evidence export --run N
 *   node .../daily_store.mjs report save --run N --file report.json
 *   node .../daily_store.mjs report export --run N --out docs/daily/YYYYMMDD
 *   node .../daily_store.mjs admin purge-run --run N --confirm
 */
import fs from "node:fs";
import path from "node:path";
import { openDb } from "../lib/db.mjs";
import { migrate } from "../lib/migrations.mjs";
import { loadRegistry } from "../lib/registry.mjs";
import * as store from "../lib/store.mjs";

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args.flags[key] = true;
      else {
        args.flags[key] = next;
        i += 1;
      }
    } else args._.push(arg);
  }
  return args;
}

function out(data) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function requireFlag(flags, name) {
  const value = flags[name];
  if (value === undefined || value === true) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function requireRunId(flags) {
  return Number(requireFlag(flags, "run"));
}

/** deep.json → per-topic article rows (shape produced by scrape_site.mjs). */
function articlesFromDeep(deep) {
  if (!Array.isArray(deep?.deep)) throw new Error("deep.json must contain a deep array");
  return deep.deep.map((topic) => ({
    sourceId: String(topic.tid),
    coverage: topic.post_coverage ?? {},
    content: {
      title: topic.title,
      url: topic.url,
      posts: topic.posts ?? [],
      externalLinks: topic.externalLinks ?? [],
      depth: topic.depth ?? 1,
      section: topic.category ?? topic.node ?? null,
    },
  }));
}

/** list.json → list_items rows. */
function itemsFromList(list, adapter) {
  const items = [];
  const seen = new Set();
  for (const category of list.categories ?? []) {
    for (const topic of category.topics ?? []) {
      const sourceId = String(topic.tid);
      if (seen.has(sourceId)) continue;
      seen.add(sourceId);
      items.push({
        sourceId,
        title: topic.title ?? "",
        url: adapter ? adapter.topicUrl(sourceId) : "",
        section: category.key ?? null,
        metadata: {
          replies: topic.replies ?? null,
          posts: topic.posts ?? null,
          views: topic.views ?? null,
          node: topic.node ?? null,
          author: topic.author ?? null,
          categoryName: category.name ?? null,
        },
      });
    }
  }
  return items;
}

async function buildSummary(db, runId) {
  const run = store.getRun(db, runId);
  const items = store.listReportItems(db, runId);
  const registry = await loadRegistry();
  const dateYmd = run.date_ymd;
  const date = `${dateYmd.slice(0, 4)}-${dateYmd.slice(4, 6)}-${dateYmd.slice(6, 8)}`;

  const cards = new Map();
  const summaryItems = items.map((item) => {
    const site = registry.get(item.siteId);
    if (!cards.has(item.direction)) {
      cards.set(item.direction, {
        id: item.direction,
        name: item.directionName,
        events: [],
        sources: new Set(),
      });
    }
    const card = cards.get(item.direction);
    card.sources.add(item.siteId);
    const id = `${item.siteId}-${item.sourceId}`;
    card.events.push({ text: item.blurb, itemId: id });
    return {
      id,
      sourceId: item.sourceId,
      source: item.siteId,
      title: item.title,
      blurb: item.blurb,
      direction: item.direction,
      directionName: item.directionName,
      links: [{ label: "主帖", url: item.url || site?.topicUrl(item.sourceId) || "" }],
      coverage: item.coverage,
      analysis: item.analysis,
      validity: item.validity,
      conclusion: item.conclusion,
      tags: item.tags,
    };
  });

  const usedSites = [...new Set(items.map((item) => item.siteId))];
  return {
    schemaVersion: 1,
    date,
    dateYmd,
    generatedAt: new Date().toISOString(),
    sites: usedSites.map((id) => ({
      id,
      label: registry.get(id)?.label ?? id,
      badgeColor: registry.get(id)?.badgeColor ?? null,
    })),
    sourceNote: `由 ${usedSites.map((id) => registry.get(id)?.label ?? id).join("、")} ${usedSites.length} 个站点合并生成。`,
    directionCards: [...cards.values()].map((card) => ({
      id: card.id,
      name: card.name,
      summary: `收录 ${card.events.length} 条，来源：${[...card.sources]
        .map((id) => registry.get(id)?.label ?? id)
        .join("、")}。`,
      events: card.events,
    })),
    globalNotes: [],
    items: summaryItems,
    crossLinks: [],
    risks: [],
  };
}

const COMMANDS = {
  migrate(db) {
    return { applied: migrate(db) };
  },
  async "sites sync"(db) {
    const registry = await loadRegistry();
    return store.syncSites(db, registry.all().map((site) => ({
      id: site.id,
      name: site.name,
      label: site.label,
      enabled: site.enabled,
      adapter: site.adapterPath,
      config: { badgeColor: site.badgeColor, requiresDisclaimer: site.requiresDisclaimer },
    })));
  },
  "sites list"(db, flags) {
    return { sites: store.listSites(db, { enabledOnly: !!flags.enabled }) };
  },
  "run start"(db, flags) {
    return store.startRun(db, requireFlag(flags, "date"));
  },
  "run get"(db, flags) {
    return store.getRun(db, requireRunId(flags));
  },
  "run latest"(db, flags) {
    return { run: store.latestRun(db, flags.date === true ? null : flags.date) };
  },
  "run finish"(db, flags) {
    return store.finishRun(db, requireRunId(flags), flags.status || "done");
  },
  "stage set"(db, flags) {
    return store.setStage(
      db,
      requireRunId(flags),
      requireFlag(flags, "stage"),
      requireFlag(flags, "status"),
      flags.error === true ? null : flags.error ?? null,
    );
  },
  async "list import"(db, flags) {
    const siteId = requireFlag(flags, "site");
    const registry = await loadRegistry();
    const list = readJson(requireFlag(flags, "file"));
    return store.upsertListItems(
      db,
      requireRunId(flags),
      siteId,
      itemsFromList(list, registry.get(siteId)),
    );
  },
  "candidates export"(db, flags) {
    return {
      candidates: store.listCandidates(
        db,
        requireRunId(flags),
        flags.site === true ? null : flags.site ?? null,
      ),
    };
  },
  "selections save"(db, flags) {
    const payload = readJson(requireFlag(flags, "file"));
    const selections = Array.isArray(payload) ? payload : payload.selections;
    return store.saveSelections(db, requireRunId(flags), selections);
  },
  "selections export"(db, flags) {
    return {
      selections: store.listSelections(
        db,
        requireRunId(flags),
        flags.site === true ? null : flags.site ?? null,
      ),
    };
  },
  "article import"(db, flags) {
    const runId = requireRunId(flags);
    const siteId = requireFlag(flags, "site");
    const deep = readJson(requireFlag(flags, "file"));
    const results = articlesFromDeep(deep).map((article) => ({
      sourceId: article.sourceId,
      ...store.saveArticle(db, runId, siteId, article.sourceId, article),
    }));
    return { runId, siteId, imported: results.length, results };
  },
  "evidence save"(db, flags) {
    const payload = readJson(requireFlag(flags, "file"));
    const entries = Array.isArray(payload) ? payload : payload.evidence;
    return store.saveEvidence(db, requireRunId(flags), entries);
  },
  "evidence export"(db, flags) {
    return { evidence: store.listEvidence(db, requireRunId(flags)) };
  },
  "report save"(db, flags) {
    const payload = readJson(requireFlag(flags, "file"));
    const items = Array.isArray(payload) ? payload : payload.items;
    return store.saveReportItems(db, requireRunId(flags), items);
  },
  async "report export"(db, flags) {
    const runId = requireRunId(flags);
    const summary = await buildSummary(db, runId);
    const outDir = path.resolve(requireFlag(flags, "out"));
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "summary.json");
    fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    return { runId, out: outPath, items: summary.items.length };
  },
  "admin purge-run"(db, flags) {
    if (!flags.confirm) throw new Error("admin purge-run requires --confirm");
    return store.purgeRun(db, requireRunId(flags));
  },
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const two = args._.slice(0, 2).join(" ");
  const one = args._[0] ?? "";
  const handler = COMMANDS[two] || COMMANDS[one];
  if (!handler) {
    process.stderr.write(
      `unknown command: ${args._.join(" ") || "(none)"}\nsee this file's header for usage\n`,
    );
    process.exit(1);
  }
  const db = openDb();
  try {
    out(await handler(db, args.flags));
  } finally {
    db.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
