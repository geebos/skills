/**
 * scrape_core — browser/session plumbing shared by every site adapter.
 *
 * Everything here was byte-identical across the original per-site scrapers.
 * Site-specific DOM knowledge lives in scripts/sites/<id>.mjs.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.resolve(__dirname, "..");

/** Repo root whether this file lives under skill lib/ or repo scripts/. */
export function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    // AGENTS.md / STOCKS.md only exist at the true repo root — NOT package.json,
    // which the skill dir also has (SDK dependency) and would false-match.
    if (
      fs.existsSync(path.join(dir, "STOCKS.md")) ||
      fs.existsSync(path.join(dir, "AGENTS.md"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(SKILL_DIR, "../../..");
}

export const ROOT = process.env.MONKFISH_ROOT
  ? path.resolve(process.env.MONKFISH_ROOT)
  : findRepoRoot(__dirname);

const SDK_PKG = "@geebos/browser-mcp";
const SDK_EXPORT = "@geebos/browser-mcp/sdk";

export const DELAY_BETWEEN_TOPICS_MS = Number(process.env.SCAN_TOPIC_DELAY_MS || 2500);
export const DELAY_AFTER_OPEN_MS = Number(process.env.SCAN_OPEN_DELAY_MS || 800);
export const DELAY_BETWEEN_CATEGORIES_MS = Number(
  process.env.SCAN_CATEGORY_DELAY_MS || 1500,
);
export const COOKED_LIMIT = Number(process.env.COOKED_LIMIT || 9);
export const LIST_LIMIT = Number(process.env.LIST_LIMIT || 30);

export function shanghaiDateYmd() {
  if (process.env.DATE && /^\d{8}$/.test(process.env.DATE)) {
    return process.env.DATE;
  }
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()).replace(/-/g, "");
}

// ── SDK resolve ─────────────────────────────────────────────────
function runOk(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  if ((r.status ?? 1) !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    throw new Error(`${cmd} ${args.join(" ")} failed: ${err.slice(0, 400)}`);
  }
  return r;
}

function packageInstalled() {
  return (
    fs.existsSync(
      path.join(SKILL_DIR, "node_modules", "@geebos", "browser-mcp", "package.json"),
    ) ||
    fs.existsSync(
      path.join(ROOT, "node_modules", "@geebos", "browser-mcp", "package.json"),
    )
  );
}

export async function loadSdk() {
  if (process.env.BROWSER_MCP_SDK) {
    const p = process.env.BROWSER_MCP_SDK;
    if (!fs.existsSync(p)) {
      throw new Error(`BROWSER_MCP_SDK not found: ${p}`);
    }
    const abs = path.resolve(p);
    console.error(`[scan] loading browser-mcp SDK from ${abs}`);
    return import(pathToFileURL(abs).href);
  }

  // fallback: CLIProxyAPI install if this repo has none
  const cliproxySdk = path.join(
    process.env.HOME || "",
    "workplace/github/CLIProxyAPI/node_modules/@geebos/browser-mcp/server/dist/sdk.js",
  );

  if (!packageInstalled()) {
    const skillPkgJson = path.join(SKILL_DIR, "package.json");
    const rootPkgJson = path.join(ROOT, "package.json");
    const installDir = fs.existsSync(skillPkgJson) ? SKILL_DIR : ROOT;
    const pkgJson = installDir === SKILL_DIR ? skillPkgJson : rootPkgJson;
    if (fs.existsSync(pkgJson)) {
      console.error(`[scan] installing ${SDK_PKG} in ${installDir} (GitHub Packages)…`);
      try {
        runOk("npm", ["install", "--no-fund", "--no-audit"], {
          cwd: installDir,
          stdio: "inherit",
        });
      } catch (e) {
        if (fs.existsSync(cliproxySdk)) {
          console.error(`[scan] npm install failed; falling back to CLIProxyAPI SDK`);
          return import(pathToFileURL(cliproxySdk).href);
        }
        throw e;
      }
    } else if (fs.existsSync(cliproxySdk)) {
      console.error(`[scan] loading SDK from CLIProxyAPI fallback`);
      return import(pathToFileURL(cliproxySdk).href);
    } else {
      throw new Error(
        `missing ${pkgJson}; add dependency "${SDK_PKG}" and run npm install`,
      );
    }
  }

  try {
    console.error(`[scan] loading ${SDK_EXPORT}`);
    return await import(SDK_EXPORT);
  } catch (e) {
    if (fs.existsSync(cliproxySdk)) {
      console.error(`[scan] package import failed; CLIProxyAPI fallback`);
      return import(pathToFileURL(cliproxySdk).href);
    }
    throw new Error(
      `failed to import ${SDK_EXPORT}: ${e.message}\n` +
        `Ensure ~/.npmrc has:\n` +
        `  @geebos:registry=https://npm.pkg.github.com\n` +
        `  //npm.pkg.github.com/:_authToken=<GITHUB_PAT with read:packages>\n` +
        `Then: npm install`,
    );
  }
}

// ── HTML helpers ────────────────────────────────────────────────
export function stripTags(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseIntLoose(s) {
  if (s == null) return null;
  const n = Number(String(s).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Shared external-link extraction; each site supplies its own skip regex. */
export function extractLinksWith(skipRe, joinedHtml) {
  const links = [];
  const seen = new Set();
  for (const match of joinedHtml.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
    const href = match[1];
    if (skipRe.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    links.push(href);
  }
  return links.slice(0, 30);
}

/**
 * Declared-vs-scraped post accounting. `wording` keeps each site's original
 * note phrasing so stored coverage notes stay stable across the refactor.
 */
export function buildPostCoverage(
  { listPosts, pagePosts, cookedCount, cookedLimit },
  wording = {},
) {
  const unit = wording.unit ?? "posts";
  const unknownNote =
    wording.unknownNote ?? "could not parse reply count from list or topic page";
  const partialHint = wording.partialHint ?? "DOM incomplete or paginated replies";

  const declared =
    pagePosts != null ? pagePosts : listPosts != null ? listPosts : null;
  const source =
    pagePosts != null ? "topic_page" : listPosts != null ? "list" : "unknown";
  const scraped = cookedCount ?? 0;
  const limit = cookedLimit ?? COOKED_LIMIT;
  let status;
  let note;
  if (declared == null) {
    status = "unknown";
    note = unknownNote;
  } else if (scraped >= declared) {
    status = "complete";
    note = `scraped ${scraped} ${unit} >= declared ${declared}`;
  } else if (scraped >= limit && declared > limit) {
    status = "capped";
    note = `declared ${declared} posts; scraped first ${scraped} (COOKED_LIMIT=${limit}); remaining ${declared - scraped} not fetched`;
  } else if (scraped < declared) {
    status = "partial";
    note = `declared ${declared} but only scraped ${scraped} ${unit} (below limit ${limit}) — ${partialHint}`;
  } else {
    status = "complete";
    note = `scraped ${scraped}, declared ${declared}`;
  }
  const repliesDeclared =
    declared != null && declared >= 1 ? Math.max(0, declared - 1) : null;
  const commentsScraped = Math.max(0, scraped - 1);
  return {
    declared_posts: declared,
    declared_replies: repliesDeclared,
    declared_source: source,
    list_posts: listPosts ?? null,
    page_posts: pagePosts ?? null,
    cooked_scraped: scraped,
    comments_scraped: commentsScraped,
    cooked_limit: limit,
    status, // complete | capped | partial | unknown
    note,
    mismatch: declared != null && scraped < declared,
  };
}

// ── browser helpers ─────────────────────────────────────────────
function jitter(ms) {
  const j = ms * 0.2;
  return Math.max(0, Math.round(ms - j + Math.random() * 2 * j));
}

export async function politeSleep(ms, label = "") {
  const t = jitter(ms);
  if (t <= 0) return;
  if (label) console.error(`[scan] sleep ${t}ms ${label}`);
  await sleep(t);
}

export async function openTab(client, url, tabId) {
  const params = { url, active: false };
  if (tabId != null) params.tabId = tabId;
  return client.tab.open(params);
}

export async function waitXpath(client, tabId, xpath, timeoutMs = 15000) {
  return client.page.wait({ tabId, xpath, state: "attached", timeoutMs });
}

export async function xpathAll(client, tabId, xpath) {
  const r = await client.page.xpath({ tabId, xpath, all: true });
  return r.htmlList || (r.html ? [r.html] : []);
}

/** Load sibling list.json (written by --mode list) for deep-mode cross-check. */
export function loadListByTid(listPath) {
  const map = new Map();
  if (!fs.existsSync(listPath)) {
    console.error(
      `[scan] no list.json at ${listPath} — deep coverage falls back to topic page only`,
    );
    return map;
  }
  try {
    const data = JSON.parse(fs.readFileSync(listPath, "utf8"));
    for (const cat of data.categories || []) {
      for (const t of cat.topics || []) {
        const tid = String(t.tid);
        if (map.has(tid)) continue;
        map.set(tid, { ...t, category: cat.key, categoryName: cat.name });
      }
    }
    console.error(`[scan] loaded ${map.size} list rows from ${listPath}`);
  } catch (e) {
    console.error(`[scan] list.json parse failed: ${e.message}`);
  }
  return map;
}

// ── scrape steps ────────────────────────────────────────────────
export async function scrapeTargetList(client, tabId, site, target) {
  const url = site.listUrl(target);
  console.error(`[scan] list ${target.key} ${url}`);
  const open = await openTab(client, url, tabId);
  const id = open.tabId;
  await politeSleep(DELAY_AFTER_OPEN_MS, "after tab open");
  await waitXpath(client, id, site.listWaitXpath, 20000);
  const rowHtml = await xpathAll(client, id, site.listRowXpath);
  let rows = site.parseListRows(rowHtml);
  if (!rows.length && site.listRowFallbackXpath) {
    const links = await xpathAll(client, id, site.listRowFallbackXpath);
    rows = site.parseListFallback ? site.parseListFallback(links) : [];
  }
  // Slice before filtering, matching the original per-site scrapers: the cap
  // applies to raw rows, so filtered categories can yield fewer than LIST_LIMIT.
  rows = rows.slice(0, LIST_LIMIT);
  if (site.filterListRow) rows = rows.filter((row) => site.filterListRow(row));
  console.error(`[scan] ${target.key}: ${rows.length} topics`);
  return { tabId: id, rows };
}

export async function scrapeTopic(client, tabId, site, tid, listMeta = null) {
  const url = site.topicUrl(tid);
  console.error(`[scan] topic ${tid}`);
  const open = await openTab(client, url, tabId);
  const id = open.tabId;
  await politeSleep(DELAY_AFTER_OPEN_MS, "after topic open");
  await waitXpath(client, id, site.topicWaitXpath, 15000);

  const ctx = {
    client,
    tabId: id,
    xpathAll: (xpath) => xpathAll(client, id, xpath),
    cookedLimit: COOKED_LIMIT,
  };
  const parsed = await site.parseTopic(ctx, tid, listMeta);
  const coverage = buildPostCoverage(
    {
      listPosts: parsed.listPosts ?? null,
      pagePosts: parsed.pagePosts ?? null,
      cookedCount: parsed.posts.length,
      cookedLimit: COOKED_LIMIT,
    },
    site.coverageWording,
  );

  console.error(
    `[scan] coverage ${tid} status=${coverage.status} declared=${coverage.declared_posts} scraped=${coverage.cooked_scraped}` +
      (coverage.mismatch ? ` — ${coverage.note}` : ""),
  );

  return {
    tabId: id,
    topic: {
      tid: String(tid),
      url,
      title: parsed.title,
      posts: parsed.posts,
      externalLinks: parsed.links,
      cookedCount: parsed.posts.length,
      posts_count: coverage.declared_posts,
      replies_count: coverage.declared_replies,
      post_coverage: coverage,
    },
  };
}

/** Copy the list-row fields this site declared worth carrying into deep.json. */
export function applyListMeta(topic, listMeta, listMetaFields) {
  if (!listMeta) return;
  topic.listTitle = listMeta.title;
  topic.listExcerpt = listMeta.excerpt;
  topic.listPosts = listMeta.posts;
  topic.listReplies = listMeta.replies;
  topic.listViews = listMeta.views;
  topic.category = listMeta.category;
  topic.categoryName = listMeta.categoryName;
  for (const field of listMetaFields ?? []) {
    topic[field] = listMeta[field];
  }
}
