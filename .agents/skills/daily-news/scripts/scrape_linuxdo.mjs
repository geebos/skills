#!/usr/bin/env node
/**
 * scrape-linuxdo — multi-category linux.do list + topic scraper via browser-mcp SDK.
 *
 * Skill: .agents/skills/daily-news/
 *
 * Usage (from repo root) — two modes; agent picks deep tids between them:
 *   BROWSER_MCP_TOKEN=test node .agents/skills/daily-news/scripts/scrape_linuxdo.mjs --mode list
 *   node .../scrape_linuxdo.mjs --mode deep --tids 2633331,2633318
 *
 * Flow: list → list.json; agent reads it and picks tids; deep → deep.json
 * (deep mode auto-loads sibling list.json for coverage cross-check).
 *
 * Env:
 *   BROWSER_MCP_TOKEN   (required for extension bind; default "test")
 *   BROWSER_MCP_SDK     optional path to sdk.js
 *   MONKFISH_ROOT       optional explicit repo root
 *   BROWSER_MCP_WS_PORT / BROWSER_MCP_WS_PORT_MAX
 *   SCAN_TOPIC_DELAY_MS / SCAN_OPEN_DELAY_MS / SCAN_CATEGORY_DELAY_MS
 *   OUTPUT_DIR          override output dir (default docs/daily/linuxdo/YYYYMMDD)
 *   DATE                override YYYYMMDD (Asia/Shanghai)
 *   COOKED_LIMIT        max cooked nodes per topic (default 9 = OP + 8 comments)
 *   LIST_LIMIT          max topic rows per category (default 30)
 *
 * SDK: @geebos/browser-mcp from GitHub Packages (see package.json).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, "..");

/** Repo root whether this file lives under skill scripts/ or repo scripts/. */
function findRepoRoot(startDir) {
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
  // skill: .agents/skills/daily-news/scripts → repo root
  if (
    path.basename(startDir) === "scripts" &&
    path.basename(path.dirname(startDir)) === "daily-news"
  ) {
    return path.resolve(startDir, "../../../..");
  }
  return path.resolve(startDir, "../..");
}

const ROOT = process.env.MONKFISH_ROOT
  ? path.resolve(process.env.MONKFISH_ROOT)
  : findRepoRoot(__dirname);

const SDK_PKG = "@geebos/browser-mcp";
const SDK_EXPORT = "@geebos/browser-mcp/sdk";

const DELAY_BETWEEN_TOPICS_MS = Number(process.env.SCAN_TOPIC_DELAY_MS || 2500);
const DELAY_AFTER_OPEN_MS = Number(process.env.SCAN_OPEN_DELAY_MS || 800);
const DELAY_BETWEEN_CATEGORIES_MS = Number(
  process.env.SCAN_CATEGORY_DELAY_MS || 1500,
);
const COOKED_LIMIT = Number(process.env.COOKED_LIMIT || 9);
const LIST_LIMIT = Number(process.env.LIST_LIMIT || 30);

/** Default categories documented in references/categories.md. */
const DEFAULT_CATEGORIES = [
  { key: "news", name: "前沿快讯", path: "/c/news/34" },
  { key: "develop", name: "开发调优", path: "/c/develop/4" },
  { key: "resource", name: "资源荟萃", path: "/c/resource/14" },
  { key: "welfare", name: "福利羊毛", path: "/c/welfare/36" },
  { key: "startup", name: "扬帆起航", path: "/c/startup/46" },
];

const OPTIONAL_CATEGORIES = [
  { key: "domestic", name: "国产替代", path: "/c/domestic/98" },
  { key: "cloud-asset", name: "网盘资源", path: "/c/resource/cloud-asset/94" },
  { key: "gossip", name: "搞七捻三", path: "/c/gossip/11" },
];

// ── CLI ─────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {
    mode: "list", // list | deep | custom
    tids: [],
    categories: null, // null = default
    includeOptional: false,
    outPath: null,
    maxDepth: 1,
    xpath: null,
    url: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode" && argv[i + 1]) out.mode = argv[++i];
    else if (a === "--tids" && argv[i + 1]) {
      out.tids = argv[++i]
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--categories" && argv[i + 1]) {
      out.categories = argv[++i]
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--include-optional") out.includeOptional = true;
    else if (a === "--out" && argv[i + 1]) out.outPath = argv[++i];
    else if ((a === "--max-depth" || a === "--depth") && argv[i + 1]) {
      out.maxDepth = Math.min(2, Math.max(1, parseInt(argv[++i], 10) || 1));
    } else if (a === "--xpath" && argv[i + 1]) out.xpath = argv[++i];
    else if (a === "--url" && argv[i + 1]) out.url = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  if (out.xpath && out.mode === "list") out.mode = "custom";
  return out;
}

function shanghaiDateYmd() {
  if (process.env.DATE && /^\d{8}$/.test(process.env.DATE)) {
    return process.env.DATE;
  }
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA → YYYY-MM-DD
  return fmt.format(new Date()).replace(/-/g, "");
}

function resolveCategories(args) {
  const all = [
    ...DEFAULT_CATEGORIES,
    ...(args.includeOptional ? OPTIONAL_CATEGORIES : []),
  ];
  if (!args.categories || !args.categories.length) return all;
  const byKey = new Map(all.map((c) => [c.key, c]));
  const byPath = new Map(all.map((c) => [c.path, c]));
  const out = [];
  for (const raw of args.categories) {
    if (byKey.has(raw)) out.push(byKey.get(raw));
    else if (byPath.has(raw)) out.push(byPath.get(raw));
    else if (raw.startsWith("/c/")) {
      const slug = raw.split("/").filter(Boolean);
      out.push({
        key: slug[1] || raw,
        name: raw,
        path: raw.replace(/\/l\/latest$/, ""),
      });
    } else {
      console.error(`[scan] unknown category key: ${raw}`);
    }
  }
  return out;
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

async function importSdkPackage() {
  console.error(`[scan] loading ${SDK_EXPORT}`);
  return import(SDK_EXPORT);
}

async function loadSdk() {
  if (process.env.BROWSER_MCP_SDK) {
    const p = process.env.BROWSER_MCP_SDK;
    if (!fs.existsSync(p)) {
      throw new Error(`BROWSER_MCP_SDK not found: ${p}`);
    }
    const abs = path.resolve(p);
    console.error(`[scan] loading browser-mcp SDK from ${abs}`);
    return import(pathToFileURL(abs).href);
  }

  // fallback: CLIProxyAPI install if monkfish has none
  const cliproxySdk = path.join(
    process.env.HOME || "",
    "workplace/github/CLIProxyAPI/node_modules/@geebos/browser-mcp/server/dist/sdk.js",
  );

  if (!packageInstalled()) {
    // prefer skill-local install (self-contained / distributable)
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
          console.error(
            `[scan] npm install failed; falling back to CLIProxyAPI SDK`,
          );
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
    return await importSdkPackage();
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
function stripTags(s) {
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

/** Discourse posts_count = OP + replies (total posts in topic). */
function parseIntLoose(s) {
  if (s == null) return null;
  const n = Number(String(s).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract total post count from a topic-list row HTML.
 * Tries data attrs, posts column, aria/title, then bare number in posts cell.
 */
function parseListPostCount(rowHtml) {
  const h = rowHtml || "";
  const patterns = [
    /data-topic-posts-count="(\d+)"/i,
    /data-posts-count="(\d+)"/i,
    /data-post-count="(\d+)"/i,
    /class="[^"]*\bposts\b[^"]*"[^>]*>\s*([0-9][0-9,]*)/i,
    /class="[^"]*posts-map[^"]*"[^>]*>[\s\S]*?>([0-9][0-9,]*)\s*</i,
    /number\s+of\s+posts[^>]*>\s*([0-9][0-9,]*)/i,
    /title="[^"]*([0-9][0-9,]*)\s*(?:posts?|帖|回复|楼)[^"]*"/i,
    /aria-label="[^"]*([0-9][0-9,]*)\s*(?:posts?|帖|回复)[^"]*"/i,
    /<td[^>]*class="[^"]*\bnum\b[^"]*\bposts\b[^"]*"[^>]*>[\s\S]*?([0-9][0-9,]*)/i,
  ];
  for (const re of patterns) {
    const m = h.match(re);
    if (m) {
      const n = parseIntLoose(m[1]);
      if (n != null && n >= 0) return n;
    }
  }
  return null;
}

function parseListViews(rowHtml) {
  const h = rowHtml || "";
  const patterns = [
    /data-topic-views="(\d+)"/i,
    /data-views="(\d+)"/i,
    /class="[^"]*\bviews\b[^"]*"[^>]*>\s*([0-9][0-9,]*)/i,
    /<td[^>]*class="[^"]*\bnum\b[^"]*\bviews\b[^"]*"[^>]*>[\s\S]*?([0-9][0-9,]*)/i,
  ];
  for (const re of patterns) {
    const m = h.match(re);
    if (m) {
      const n = parseIntLoose(m[1]);
      if (n != null && n >= 0) return n;
    }
  }
  return null;
}

/**
 * Extract posts_count from a rendered topic page (not list).
 * Discourse often shows total in map button / timeline / header.
 */
function parseTopicPagePostCount(htmlChunks) {
  const joined = (htmlChunks || []).join("\n");
  const patterns = [
    /data-topic-posts-count="(\d+)"/i,
    /data-posts-count="(\d+)"/i,
    /posts_count["']?\s*[:=]\s*(\d+)/i,
    /class="[^"]*replies-count[^"]*"[^>]*>\s*([0-9][0-9,]*)/i,
    // "12 posts" / "12 帖" / "共 12 楼"
    /\b([0-9][0-9,]*)\s*(?:posts?|帖子|帖|楼)\b/i,
    /(?:posts?|帖子|回复)\s*[:：]?\s*([0-9][0-9,]*)/i,
    /title="[^"]*([0-9][0-9,]*)\s*(?:posts?|帖|回复)[^"]*"/i,
    /aria-label="[^"]*([0-9][0-9,]*)\s*(?:posts?|帖|回复)[^"]*"/i,
  ];
  for (const re of patterns) {
    const m = joined.match(re);
    if (m) {
      const n = parseIntLoose(m[1]);
      // ignore tiny false positives from "1 post" in widgets if many hits — take first plausible >=1
      if (n != null && n >= 1 && n < 100000) return n;
    }
  }
  return null;
}

function parseTopicRows(htmlList) {
  const rows = [];
  for (const h of htmlList || []) {
    const idM = h.match(/data-topic-id="(\d+)"/);
    if (!idM) continue;
    const tid = idM[1];
    const tM = h.match(
      /class="title raw-link raw-topic-link"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/,
    );
    let title = tM ? stripTags(tM[1]) : "";
    if (!title) {
      const tM2 = h.match(
        /class="title raw-link raw-topic-link"[^>]*>([\s\S]*?)<\/a>/,
      );
      title = tM2 ? stripTags(tM2[1]) : "";
    }
    const eM = h.match(/class="topic-excerpt"[^>]*>([\s\S]*?)<\/[a-z]+>/i);
    const excerpt = eM ? stripTags(eM[1]).slice(0, 240) : "";
    const posts = parseListPostCount(h);
    const views = parseListViews(h);
    // replies ≈ posts_count - 1 (OP); keep both for ranking/coverage
    const replies =
      posts != null && posts >= 1 ? Math.max(0, posts - 1) : null;
    rows.push({ tid, title, excerpt, posts, replies, views });
  }
  return rows;
}

/**
 * Compare declared total posts vs cooked nodes scraped under COOKED_LIMIT.
 * posts_count is OP+comments; cookedCount is what we extracted this round.
 */
function buildPostCoverage({
  listPosts,
  pagePosts,
  cookedCount,
  cookedLimit,
}) {
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
    note = "could not parse posts_count from list or topic page";
  } else if (scraped >= declared) {
    status = "complete";
    note = `scraped ${scraped} cooked >= declared ${declared}`;
  } else if (scraped >= limit && declared > limit) {
    status = "capped";
    note = `declared ${declared} posts; scraped first ${scraped} (COOKED_LIMIT=${limit}); remaining ${declared - scraped} not fetched`;
  } else if (scraped < declared) {
    status = "partial";
    note = `declared ${declared} but only scraped ${scraped} cooked (below limit ${limit}) — DOM incomplete or hidden posts`;
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

function isCategoryMetaTitle(title) {
  return /^关于/.test(title || "") || /类别说明|版块说明/.test(title || "");
}

function extractLinks(joinedHtml) {
  const links = [];
  const seen = new Set();
  for (const m of joinedHtml.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
    const href = m[1];
    if (/linux\.do|ldstatic|cdn\.|avatar|emoji/i.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    links.push(href);
  }
  return links.slice(0, 30);
}

// ── browser helpers ─────────────────────────────────────────────
function jitter(ms) {
  const j = ms * 0.2;
  return Math.max(0, Math.round(ms - j + Math.random() * 2 * j));
}

async function politeSleep(ms, label = "") {
  const t = jitter(ms);
  if (t <= 0) return;
  if (label) console.error(`[scan] sleep ${t}ms ${label}`);
  await sleep(t);
}

async function openTab(client, url, tabId) {
  const params = { url, active: false };
  if (tabId != null) params.tabId = tabId;
  return client.tab.open(params);
}

async function waitXpath(client, tabId, xpath, timeoutMs = 15000) {
  return client.page.wait({
    tabId,
    xpath,
    state: "attached",
    timeoutMs,
  });
}

async function xpathAll(client, tabId, xpath) {
  const r = await client.page.xpath({ tabId, xpath, all: true });
  return r.htmlList || (r.html ? [r.html] : []);
}

// ── scrape steps ────────────────────────────────────────────────
async function scrapeCategoryList(client, tabId, cat) {
  const url = `https://linux.do${cat.path}/l/latest`;
  console.error(`[scan] list ${cat.key} ${url}`);
  const open = await openTab(client, url, tabId);
  const id = open.tabId;
  await politeSleep(DELAY_AFTER_OPEN_MS, "after category open");
  await waitXpath(
    client,
    id,
    "//a[contains(@class,'raw-topic-link')]",
    20000,
  );
  const rowHtml = await xpathAll(
    client,
    id,
    "//tr[contains(@class,'topic-list-item')]",
  );
  let rows = parseTopicRows(rowHtml);
  // fallback: link-only if tr structure missing
  if (!rows.length) {
    const links = await xpathAll(
      client,
      id,
      "//a[contains(@class,'raw-topic-link')]",
    );
    for (const h of links) {
      const idM = h.match(/\/t\/[^/"]+\/(\d+)/) || h.match(/data-topic-id="(\d+)"/);
      if (!idM) continue;
      const title = stripTags(h).slice(0, 200);
      rows.push({
        tid: idM[1],
        title,
        excerpt: "",
        posts: null,
        replies: null,
        views: null,
      });
    }
  }
  rows = rows.slice(0, LIST_LIMIT);
  const withPosts = rows.filter((r) => r.posts != null).length;
  console.error(
    `[scan] ${cat.key} post-count parsed ${withPosts}/${rows.length}`,
  );
  return { tabId: id, rows };
}

async function scrapeTopic(client, tabId, tid, listMeta = null) {
  const url = `https://linux.do/t/topic/${tid}`;
  console.error(`[scan] topic ${tid}`);
  const open = await openTab(client, url, tabId);
  const id = open.tabId;
  await politeSleep(DELAY_AFTER_OPEN_MS, "after topic open");
  await waitXpath(client, id, "//div[contains(@class,'cooked')]", 15000);

  const titleHtml = await xpathAll(
    client,
    id,
    "//*[contains(@class,'fancy-title') or contains(@class,'topic-title')]",
  );
  const title = titleHtml.length ? stripTags(titleHtml[0]).slice(0, 300) : "";

  // meta / map / timeline often carry posts_count (avoid body/html — too large)
  const metaHtml = await xpathAll(
    client,
    id,
    "//*[contains(@class,'topic-map') or contains(@class,'posts-map') or contains(@class,'topic-stats') or contains(@class,'timeline-replies') or contains(@class,'replies-count') or contains(@class,'topic-status-info')]",
  ).catch(() => []);
  let pagePosts = parseTopicPagePostCount(
    (metaHtml || []).filter((h) => h && h.length < 200_000).slice(0, 20),
  );
  if (pagePosts == null) {
    // one more try: posts map button only
    const mapHtml = await xpathAll(
      client,
      id,
      "//button[contains(@class,'posts-map') or contains(@class,'map')]|//*[contains(@class,'posts-map')]",
    ).catch(() => []);
    pagePosts = parseTopicPagePostCount(mapHtml);
  }

  const cooked = await xpathAll(
    client,
    id,
    `(//div[contains(@class,'cooked')])[position() <= ${COOKED_LIMIT}]`,
  );
  const posts = cooked.map((html, i) => ({
    index: i,
    role: i === 0 ? "op" : "comment",
    text: stripTags(html).slice(0, 4000),
    htmlLength: html.length,
  }));
  const joined = cooked.join("\n");
  const links = extractLinks(joined);

  const listPosts = listMeta?.posts ?? null;
  const coverage = buildPostCoverage({
    listPosts,
    pagePosts,
    cookedCount: cooked.length,
    cookedLimit: COOKED_LIMIT,
  });

  if (coverage.mismatch) {
    console.error(
      `[scan] coverage ${tid} status=${coverage.status} declared=${coverage.declared_posts} scraped=${coverage.cooked_scraped} — ${coverage.note}`,
    );
  } else {
    console.error(
      `[scan] coverage ${tid} status=${coverage.status} declared=${coverage.declared_posts} scraped=${coverage.cooked_scraped}`,
    );
  }

  return {
    tabId: id,
    topic: {
      tid: String(tid),
      url,
      title,
      posts,
      externalLinks: links,
      cookedCount: cooked.length,
      posts_count: coverage.declared_posts,
      replies_count: coverage.declared_replies,
      post_coverage: coverage,
    },
  };
}

/** Load sibling list.json (written by --mode list) for deep-mode cross-check. */
function loadListByTid(listPath) {
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
        map.set(tid, {
          ...t,
          category: cat.key,
          categoryName: cat.name,
        });
      }
    }
    console.error(`[scan] loaded ${map.size} list rows from ${listPath}`);
  } catch (e) {
    console.error(`[scan] list.json parse failed: ${e.message}`);
  }
  return map;
}

// ── main ────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  scrape_linuxdo.mjs --mode list [options]     # step 1: scan category lists → list.json
  scrape_linuxdo.mjs --mode deep --tids 1,2,3  # step 2: agent-picked tids → deep.json

Options:
  --mode list|deep        list categories (default) | deep-read agent-picked tids
  --tids 1,2,3            topic ids (deep mode; agent decides from list.json)
  --categories news,develop  keys or /c/... paths
  --include-optional      also domestic / cloud-asset / gossip
  --out path.json         output path override (default <outDir>/list.json|deep.json)

Flow: run list, agent reads list.json and picks tids, then run deep.
deep mode auto-loads sibling list.json for coverage cross-check.
`);
    return;
  }
  if (args.mode !== "list" && args.mode !== "deep" && args.mode !== "custom") {
    console.error(
      `[scan] unknown mode: ${args.mode} (expected list | deep | custom)`,
    );
    process.exit(1);
  }
  if (args.mode === "deep" && !args.tids.length) {
    console.error("[scan] --mode deep requires --tids (agent picks them from list.json)");
    process.exit(1);
  }

  const dateYmd = shanghaiDateYmd();
  const defaultOutDir =
    process.env.OUTPUT_DIR ||
    path.join(ROOT, "docs/daily/linuxdo", dateYmd);
  const outPath =
    args.outPath ||
    path.join(defaultOutDir, args.mode === "list" ? "list.json" : "deep.json");

  const { startBrowserServer, BrowserMcpError } = await loadSdk();
  const token = process.env.BROWSER_MCP_TOKEN?.trim() || "test";
  const authDir =
    process.env.BROWSER_MCP_AUTH_DIR || path.join(ROOT, ".browser-mcp");

  const server = await startBrowserServer({
    token,
    name: "daily-news-linuxdo",
    authDir,
    cwd: ROOT,
    wsPort: Number(process.env.BROWSER_MCP_WS_PORT || 11470),
    wsPortMax: Number(process.env.BROWSER_MCP_WS_PORT_MAX || 12460),
  });

  const result = {
    scraped_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    date: dateYmd,
    site: "linuxdo",
    mode: args.mode,
    categories: [],
    deep: [],
    errors: [],
  };

  let tabId = null;
  try {
    console.error(
      `[scan] ws://127.0.0.1:${server.port} name=${server.name} waiting extension…`,
    );
    await server.waitForExtension({ timeoutMs: 120_000 });
    const meta = await server.client.meta.version();
    console.error(
      `[scan] extension connected server=${meta.serverVersion} ext=${meta.extensionVersion}`,
    );

    // 0) custom mode: agent specifies custom xpath and target url to extract unformatted content
    if (args.mode === "custom" || args.xpath) {
      const targetUrl = args.url || (args.tids[0] ? `https://linux.do/t/topic/${args.tids[0]}` : null);
      if (!targetUrl || !args.xpath) {
        console.error("[scan] custom mode requires --url (or --tids) and --xpath");
        process.exit(1);
      }
      console.error(`[scan] custom xpath extract url=${targetUrl} xpath=${args.xpath}`);
      const open = await openTab(server.client, targetUrl, tabId);
      tabId = open.tabId;
      await politeSleep(DELAY_AFTER_OPEN_MS, "after custom open");
      await waitXpath(server.client, tabId, args.xpath, 20000).catch(() => {});
      const htmlList = await xpathAll(server.client, tabId, args.xpath);
      const customResult = {
        ok: true,
        mode: "custom",
        url: targetUrl,
        xpath: args.xpath,
        count: htmlList.length,
        results: htmlList.map((h, i) => ({
          index: i,
          html: h,
          text: stripTags(h),
        })),
      };
      if (args.outPath) {
        fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
        fs.writeFileSync(args.outPath, JSON.stringify(customResult, null, 2) + "\n", "utf8");
      }
      console.log(JSON.stringify(customResult, null, 2));
      return;
    }

    // 1) list mode: scan category lists, then done (agent picks deep tids)
    if (args.mode === "list") {
      const cats = resolveCategories(args);
      for (let i = 0; i < cats.length; i++) {
        const cat = cats[i];
        if (i > 0) {
          await politeSleep(
            DELAY_BETWEEN_CATEGORIES_MS,
            `before category ${cat.key}`,
          );
        }
        try {
          const { tabId: id, rows } = await scrapeCategoryList(
            server.client,
            tabId,
            cat,
          );
          tabId = id;
          const topics = rows.filter((r) => !isCategoryMetaTitle(r.title));
          result.categories.push({
            key: cat.key,
            name: cat.name,
            path: cat.path,
            url: `https://linux.do${cat.path}/l/latest`,
            topic_count: topics.length,
            topics,
          });
          console.error(
            `[scan] ${cat.key}: ${topics.length} topics (raw rows ${rows.length})`,
          );
        } catch (e) {
          result.errors.push({
            stage: "list",
            category: cat.key,
            err: String(e.message || e),
          });
          console.error(`[scan] list fail ${cat.key}:`, e.message || e);
        }
      }
    }

    // 2) deep mode: agent-picked tids; sibling list.json feeds coverage cross-check
    const listByTid =
      args.mode === "deep"
        ? loadListByTid(path.join(path.dirname(outPath), "list.json"))
        : new Map();

    if (args.mode === "deep") {
      const deepTids = [...args.tids];
      const visitedTids = new Set(deepTids.map(String));

      // Depth 1 fetch
      for (let i = 0; i < deepTids.length; i++) {
        const tid = deepTids[i];
        if (i > 0) {
          await politeSleep(DELAY_BETWEEN_TOPICS_MS, `before topic ${tid}`);
        }
        try {
          const listMeta = listByTid.get(String(tid)) || null;
          const { tabId: id, topic } = await scrapeTopic(
            server.client,
            tabId,
            tid,
            listMeta,
          );
          tabId = id;
          topic.depth = 1;
          if (listMeta) {
            topic.listTitle = listMeta.title;
            topic.listExcerpt = listMeta.excerpt;
            topic.listPosts = listMeta.posts;
            topic.listReplies = listMeta.replies;
            topic.listViews = listMeta.views;
            topic.category = listMeta.category;
            topic.categoryName = listMeta.categoryName;
          }
          result.deep.push(topic);
          const cov = topic.post_coverage || {};
          console.error(
            `[scan] deep ${tid} (depth 1) cooked=${topic.cookedCount} declared=${topic.posts_count} coverage=${cov.status} title=${(topic.title || "").slice(0, 60)}`,
          );
          if (cov.status === "partial" || cov.status === "unknown") {
            result.errors.push({
              stage: "coverage",
              tid: String(tid),
              err: cov.note || cov.status,
              coverage: cov,
            });
          }
        } catch (e) {
          result.errors.push({
            stage: "deep",
            tid: String(tid),
            err: String(e.message || e),
          });
          console.error(`[scan] deep fail ${tid}:`, e.message || e);
        }
      }

      // Depth 2 max exploration: if maxDepth >= 2, extract referenced topics from depth-1 topics
      if (args.maxDepth >= 2) {
        const depth2Tids = new Set();
        for (const topic of result.deep) {
          const textToScan =
            topic.posts.map((p) => p.text).join("\n") +
            "\n" +
            (topic.externalLinks || []).join("\n");
          const matches = textToScan.matchAll(/linux\.do\/t\/(?:topic\/)?(\d+)/gi);
          for (const m of matches) {
            const refTid = String(m[1]);
            if (!visitedTids.has(refTid)) {
              visitedTids.add(refTid);
              depth2Tids.add(refTid);
            }
          }
        }

        if (depth2Tids.size > 0) {
          console.error(`[scan] depth-2 exploration found ${depth2Tids.size} referenced topics: ${Array.from(depth2Tids).join(",")}`);
          for (const refTid of depth2Tids) {
            await politeSleep(DELAY_BETWEEN_TOPICS_MS, `before depth-2 topic ${refTid}`);
            try {
              const listMeta = listByTid.get(String(refTid)) || null;
              const { tabId: id, topic } = await scrapeTopic(
                server.client,
                tabId,
                refTid,
                listMeta,
              );
              tabId = id;
              topic.depth = 2;
              if (listMeta) {
                topic.listTitle = listMeta.title;
                topic.listExcerpt = listMeta.excerpt;
                topic.listPosts = listMeta.posts;
                topic.listReplies = listMeta.replies;
                topic.listViews = listMeta.views;
                topic.category = listMeta.category;
                topic.categoryName = listMeta.categoryName;
              }
              result.deep.push(topic);
              console.error(
                `[scan] deep ${refTid} (depth 2) cooked=${topic.cookedCount} title=${(topic.title || "").slice(0, 60)}`,
              );
            } catch (e) {
              result.errors.push({
                stage: "deep_depth2",
                tid: String(refTid),
                err: String(e.message || e),
              });
              console.error(`[scan] depth-2 fail ${refTid}:`, e.message || e);
            }
          }
        }
      }
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n", "utf8");
    console.error(`[scan] wrote ${outPath}`);

    // human summary on stdout
    const listN = result.categories.reduce(
      (a, c) => a + (c.topic_count || 0),
      0,
    );
    const coverageSummary = { complete: 0, capped: 0, partial: 0, unknown: 0 };
    for (const t of result.deep) {
      const s = t.post_coverage?.status || "unknown";
      if (coverageSummary[s] != null) coverageSummary[s] += 1;
      else coverageSummary.unknown += 1;
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          date: result.date,
          out: outPath,
          categories: result.categories.map((c) => ({
            key: c.key,
            topics: c.topic_count,
            with_posts: (c.topics || []).filter((t) => t.posts != null).length,
          })),
          deep: result.deep.length,
          coverage: coverageSummary,
          errors: result.errors.length,
          list_topics: listN,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    if (e instanceof BrowserMcpError) {
      console.error(`[scan] BrowserMcpError ${e.code}: ${e.message}`);
    } else {
      console.error("[scan] fatal:", e);
    }
    process.exitCode = 1;
  } finally {
    // Prefer close managed tab when done (monkfish task rule: no tab leak).
    // find-linuxdo-grok leaves close as no-op; here we try close then disconnect.
    if (tabId != null) {
      try {
        await server.client.tab.close({ tabId });
      } catch {
        /* extension may auto-close */
      }
    }
    await server.close().catch(() => {});
  }
}

main();
