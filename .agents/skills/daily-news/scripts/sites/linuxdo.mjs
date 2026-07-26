/**
 * linux.do (Discourse) adapter.
 *
 * Unlike the other sites, Discourse does not expose one reliable reply-count
 * node, so the declared post count is recovered heuristically from the list row
 * first and the topic page second. Those heuristics stay here as adapter
 * internals; the core only ever sees a normalized {listPosts, pagePosts}.
 */
import {
  extractLinksWith,
  parseIntLoose,
  stripTags,
} from "../../lib/scrape_core.mjs";

const HOST = "https://linux.do";

const DEFAULT_TARGETS = [
  { key: "news", name: "前沿快讯", path: "/c/news/34" },
  { key: "develop", name: "开发调优", path: "/c/develop/4" },
  { key: "resource", name: "资源荟萃", path: "/c/resource/14" },
  { key: "welfare", name: "福利羊毛", path: "/c/welfare/36" },
  { key: "startup", name: "扬帆起航", path: "/c/startup/46" },
];

const OPTIONAL_TARGETS = [
  { key: "domestic", name: "国产替代", path: "/c/domestic/98" },
  { key: "cloud-asset", name: "网盘资源", path: "/c/resource/cloud-asset/94" },
  { key: "gossip", name: "搞七捻三", path: "/c/gossip/11" },
];

const SKIP_LINK_RE = /linux\.do|ldstatic|cdn\.|avatar|emoji/i;

export const site = {
  id: "linuxdo",
  host: HOST,
  label: "linux.do",
  listMetaFields: [],
  listWaitXpath: "//a[contains(@class,'raw-topic-link')]",
  listRowXpath: "//tr[contains(@class,'topic-list-item')]",
  listRowFallbackXpath: "//a[contains(@class,'raw-topic-link')]",
  topicWaitXpath: "//div[contains(@class,'cooked')]",
  selfLinkRe: /linux\.do\/t\/(?:topic\/)?(\d+)/gi,
  provenance: {
    hosts: ["linux.do"],
    pathRegex: (sourceId) => new RegExp(`^/t/(?:topic/)?${sourceId}(?:/|$)`),
  },
  coverageWording: {
    unit: "cooked",
    unknownNote: "could not parse posts_count from list or topic page",
    partialHint: "DOM incomplete or hidden posts",
  },
  listUrl: (target) => `${HOST}${target.path}/l/latest`,
};

export function listTargets(args = {}) {
  const pool = args.includeOptional
    ? [...DEFAULT_TARGETS, ...OPTIONAL_TARGETS]
    : DEFAULT_TARGETS;
  const keys = args.categories;
  if (!keys || !keys.length) return pool;
  const byKey = new Map([...DEFAULT_TARGETS, ...OPTIONAL_TARGETS].map((t) => [t.key, t]));
  const out = [];
  for (const raw of keys) {
    if (byKey.has(raw)) out.push(byKey.get(raw));
    else if (raw.startsWith("/")) out.push({ key: raw, name: raw, path: raw });
    else console.error(`[scan] unknown category key: ${raw}`);
  }
  return out;
}

/** Total post count (OP + replies) from a topic-list row. */
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

/** posts_count from a rendered topic page (map button / timeline / header). */
function parseTopicPagePostCount(htmlChunks) {
  const joined = (htmlChunks || []).join("\n");
  const patterns = [
    /data-topic-posts-count="(\d+)"/i,
    /data-posts-count="(\d+)"/i,
    /posts_count["']?\s*[:=]\s*(\d+)/i,
    /class="[^"]*replies-count[^"]*"[^>]*>\s*([0-9][0-9,]*)/i,
    /\b([0-9][0-9,]*)\s*(?:posts?|帖子|帖|楼)\b/i,
    /(?:posts?|帖子|回复)\s*[:：]?\s*([0-9][0-9,]*)/i,
    /title="[^"]*([0-9][0-9,]*)\s*(?:posts?|帖|回复)[^"]*"/i,
    /aria-label="[^"]*([0-9][0-9,]*)\s*(?:posts?|帖|回复)[^"]*"/i,
  ];
  for (const re of patterns) {
    const m = joined.match(re);
    if (m) {
      const n = parseIntLoose(m[1]);
      if (n != null && n >= 1 && n < 100000) return n;
    }
  }
  return null;
}

export function parseListRows(htmlList) {
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
      const tM2 = h.match(/class="title raw-link raw-topic-link"[^>]*>([\s\S]*?)<\/a>/);
      title = tM2 ? stripTags(tM2[1]) : "";
    }
    const eM = h.match(/class="topic-excerpt"[^>]*>([\s\S]*?)<\/[a-z]+>/i);
    const excerpt = eM ? stripTags(eM[1]).slice(0, 240) : "";
    const posts = parseListPostCount(h);
    const views = parseListViews(h);
    const replies = posts != null && posts >= 1 ? Math.max(0, posts - 1) : null;
    rows.push({ tid, title, excerpt, posts, replies, views });
  }
  return rows;
}

export function parseListFallback(htmlList) {
  const rows = [];
  for (const h of htmlList || []) {
    const idM = h.match(/\/t\/[^/"]+\/(\d+)/) || h.match(/data-topic-id="(\d+)"/);
    if (!idM) continue;
    rows.push({
      tid: idM[1],
      title: stripTags(h).slice(0, 200),
      excerpt: "",
      posts: null,
      replies: null,
      views: null,
    });
  }
  return rows;
}

/** Drop category "about" posts, which carry no news value. */
export function filterListRow(row) {
  const title = row.title || "";
  return !(/^关于/.test(title) || /类别说明|版块说明/.test(title));
}

export function topicUrl(tid) {
  return `${HOST}/t/topic/${tid}`;
}

export async function parseTopic(ctx, tid, listMeta = null) {
  const titleHtml = await ctx.xpathAll(
    "//*[contains(@class,'fancy-title') or contains(@class,'topic-title')]",
  );
  const title = titleHtml.length ? stripTags(titleHtml[0]).slice(0, 300) : "";

  // meta / map / timeline often carry posts_count (avoid body/html — too large)
  const metaHtml = await ctx
    .xpathAll(
      "//*[contains(@class,'topic-map') or contains(@class,'posts-map') or contains(@class,'topic-stats') or contains(@class,'timeline-replies') or contains(@class,'replies-count') or contains(@class,'topic-status-info')]",
    )
    .catch(() => []);
  let pagePosts = parseTopicPagePostCount(
    (metaHtml || []).filter((h) => h && h.length < 200_000).slice(0, 20),
  );
  if (pagePosts == null) {
    const mapHtml = await ctx
      .xpathAll("//button[contains(@class,'posts-map') or contains(@class,'map')]|//*[contains(@class,'posts-map')]")
      .catch(() => []);
    pagePosts = parseTopicPagePostCount(mapHtml);
  }

  // Discourse renders OP and replies with the same `cooked` class.
  const cooked = await ctx.xpathAll(
    `(//div[contains(@class,'cooked')])[position() <= ${ctx.cookedLimit}]`,
  );
  const posts = cooked.map((html, i) => ({
    index: i,
    role: i === 0 ? "op" : "comment",
    text: stripTags(html).slice(0, 4000),
    htmlLength: html.length,
  }));

  return {
    title,
    posts,
    links: extractLinks(cooked.join("\n")),
    listPosts: listMeta?.posts ?? null,
    pagePosts,
  };
}

export function extractLinks(joinedHtml) {
  return extractLinksWith(SKIP_LINK_RE, joinedHtml);
}

export function validateArticleUrl(rawUrl, sourceId) {
  const url = new URL(rawUrl);
  return (
    ["http:", "https:"].includes(url.protocol) &&
    site.provenance.hosts.includes(url.hostname.toLowerCase()) &&
    site.provenance.pathRegex(sourceId).test(url.pathname)
  );
}
