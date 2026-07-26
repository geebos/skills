/**
 * 集思录 (WeCenter) adapter.
 *
 * DOM notes:
 *   list rows:   //div[@class='aw-item'] containing span.aw-question-replay-count
 *                (the explore promo row has no replay-count and is filtered out)
 *   reply count: span.aw-question-replay-count > em
 *   views:       "N 次浏览" in the meta text
 *   question:    no pagination — every floor lives in one DOM
 */
import {
  extractLinksWith,
  parseIntLoose,
  stripTags,
} from "../../lib/scrape_core.mjs";

const HOST = "https://www.jisilu.cn";

const DEFAULT_TARGETS = [
  { key: "explore", name: "最新", path: "/explore/" },
  { key: "bond", name: "债券/可转债", path: "/category/4" },
  { key: "fund", name: "基金", path: "/category/7" },
  { key: "arbitrage", name: "套利", path: "/category/5" },
  { key: "stock", name: "股票", path: "/category/8" },
];

const SKIP_LINK_RE = /jisilu\.cn|avatar|uploads|gravatar|static\/img/i;

export const site = {
  id: "jisilu",
  host: HOST,
  label: "集思录",
  listMetaFields: ["node", "author"],
  listWaitXpath: "//span[contains(@class,'aw-question-replay-count')]",
  listRowXpath: "//div[@class='aw-item']",
  listRowFallbackXpath: "//div[contains(@class,'aw-questoin-content')]//h4//a",
  topicWaitXpath: "//div[contains(@class,'aw-question-detail-title')]//h1",
  selfLinkRe: /jisilu\.cn\/question\/(\d+)/gi,
  provenance: {
    hosts: ["jisilu.cn", "www.jisilu.cn"],
    pathRegex: (sourceId) => new RegExp(`^/question/${sourceId}(?:/|$)`),
  },
  coverageWording: {
    unit: "posts",
    unknownNote: "could not parse reply count from list or question page",
    partialHint: "DOM incomplete or paginated replies",
  },
  listUrl: (target) => `${HOST}${target.path}`,
};

export function listTargets(args = {}) {
  const keys = args.categories;
  if (!keys || !keys.length) return DEFAULT_TARGETS;
  const byKey = new Map(DEFAULT_TARGETS.map((t) => [t.key, t]));
  const out = [];
  for (const raw of keys) {
    if (byKey.has(raw)) out.push(byKey.get(raw));
    else if (raw.startsWith("/")) out.push({ key: raw, name: raw, path: raw });
    else console.error(`[scan] unknown category key: ${raw}`);
  }
  return out;
}

/** posts = replies + 1 (OP) to keep schema parity across sites. */
export function parseListRows(htmlList) {
  const rows = [];
  for (const h of htmlList || []) {
    const idM = h.match(/\/question\/(\d+)/);
    if (!idM) continue;
    if (!/aw-question-replay-count/.test(h)) continue;
    const tid = idM[1];
    const tM = h.match(/<h4>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
    const title = tM ? stripTags(tM[1]) : "";
    const cM = h.match(/aw-question-replay-count[^>]*>[\s\S]*?<em>(\d+)<\/em>/);
    const replies = cM ? parseIntLoose(cM[1]) ?? 0 : 0;
    const vM = h.match(/([\d,]+)\s*次浏览/);
    const views = vM ? parseIntLoose(vM[1]) : null;
    const nM = h.match(/aw-question-tags[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
    const node = nM ? stripTags(nM[1]) : "";
    const aM = h.match(/贡献[\s\S]{0,300}?\/people\/([^"\/?#]+)/);
    let author = "";
    if (aM) {
      try {
        author = decodeURIComponent(aM[1]);
      } catch {
        author = aM[1];
      }
    }
    rows.push({
      tid,
      title,
      excerpt: "",
      posts: replies + 1,
      replies,
      views,
      node,
      author,
    });
  }
  return rows;
}

export function parseListFallback(htmlList) {
  const rows = [];
  for (const h of htmlList || []) {
    const idM = h.match(/\/question\/(\d+)/);
    if (!idM) continue;
    rows.push({
      tid: idM[1],
      title: stripTags(h).slice(0, 200),
      excerpt: "",
      posts: null,
      replies: null,
      views: null,
      node: "",
      author: "",
    });
  }
  return rows;
}

export function topicUrl(tid) {
  return `${HOST}/question/${tid}`;
}

export async function parseTopic(ctx, tid, listMeta = null) {
  const titleHtml = await ctx.xpathAll(
    "//div[contains(@class,'aw-question-detail-title')]//h1",
  );
  const title = titleHtml.length ? stripTags(titleHtml[0]).slice(0, 300) : "";

  const metaHtml = await ctx
    .xpathAll("//div[contains(@class,'aw-question-detail-box')]//h2")
    .catch(() => []);
  let pageReplies = null;
  for (const h of metaHtml || []) {
    const m = stripTags(h).match(/(\d+)\s*个回复/);
    if (m) {
      pageReplies = parseIntLoose(m[1]);
      break;
    }
  }

  const opHtml = await ctx.xpathAll(
    "//div[contains(@class,'aw-question-detail-txt')]",
  );
  const replyHtml = await ctx.xpathAll(
    `(//div[contains(@class,'aw-dynamic-topic')]//div[@class='markitup-box'])[position() <= ${ctx.cookedLimit - 1}]`,
  );

  const posts = [];
  if (opHtml.length) {
    posts.push({
      index: 0,
      role: "op",
      text: stripTags(opHtml[0]).slice(0, 4000),
      htmlLength: opHtml[0].length,
    });
  }
  replyHtml.forEach((html, i) => {
    posts.push({
      index: i + 1,
      role: "comment",
      text: stripTags(html).slice(0, 4000),
      htmlLength: html.length,
    });
  });

  return {
    title,
    posts,
    links: extractLinks([...opHtml, ...replyHtml].join("\n")),
    listPosts: listMeta?.replies != null ? listMeta.replies + 1 : null,
    pagePosts: pageReplies != null ? pageReplies + 1 : null,
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
