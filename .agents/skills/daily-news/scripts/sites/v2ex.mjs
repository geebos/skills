/**
 * V2EX adapter.
 *
 * DOM verified 2026-07-24 via browser-mcp probe:
 *   list rows:   //div[contains(@class,'cell item')]
 *   title:       span.item_title > a.topic-link   href="/t/{tid}#reply{N}"
 *   reply count: a.count_livid (absent when 0 replies)
 *   node:        a.item_node
 *   topic title: //div[@id='Main']//h1
 *   OP body:     //div[@class='topic_content']
 *   replies:     //div[@class='reply_content']
 *   reply meta:  span.count-text → "N 条回复"
 */
import {
  extractLinksWith,
  parseIntLoose,
  stripTags,
} from "../../lib/scrape_core.mjs";

const HOST = "https://www.v2ex.com";

const DEFAULT_TARGETS = [
  { key: "hot", name: "最热", path: "/?tab=hot" },
  { key: "creative", name: "创意", path: "/?tab=creative" },
  { key: "tech", name: "技术", path: "/?tab=tech" },
  { key: "play", name: "好玩", path: "/?tab=play" },
];

const SKIP_LINK_RE = /v2ex\.com|cdn\.v2ex|avatar|gravatar|static\/img/i;

export const site = {
  id: "v2ex",
  host: HOST,
  label: "V2EX",
  listMetaFields: ["node", "author"],
  listWaitXpath: "//span[@class='item_title']",
  listRowXpath: "//div[contains(@class,'cell item')]",
  listRowFallbackXpath: "//span[@class='item_title']/a",
  topicWaitXpath: "//div[@id='Main']//h1",
  selfLinkRe: /v2ex\.com\/t\/(\d+)/gi,
  provenance: {
    hosts: ["v2ex.com", "www.v2ex.com"],
    pathRegex: (sourceId) => new RegExp(`^/t/${sourceId}(?:/|$)`),
  },
  coverageWording: {
    unit: "posts",
    unknownNote: "could not parse reply count from list or topic page",
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
    else if (raw.startsWith("/")) {
      const key = (raw.match(/tab=([a-z]+)/) || [])[1] || raw;
      out.push({ key, name: raw, path: raw });
    } else console.error(`[scan] unknown tab key: ${raw}`);
  }
  return out;
}

/** posts = replies + 1 (OP) to keep schema parity across sites. */
export function parseListRows(htmlList) {
  const rows = [];
  for (const h of htmlList || []) {
    const idM = h.match(/href="\/t\/(\d+)/);
    if (!idM) continue;
    const tid = idM[1];
    const tM = h.match(/<span class="item_title">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
    const title = tM ? stripTags(tM[1]) : "";
    const cM = h.match(/class="count_(?:livid|orange)[^"]*"[^>]*>(\d+)</);
    const replies = cM ? parseIntLoose(cM[1]) ?? 0 : 0;
    const nM = h.match(/class="item_node"[^>]*>([\s\S]*?)<\/a>/);
    const node = nM ? stripTags(nM[1]) : "";
    const aM = h.match(/href="\/member\/([^"]+)"/);
    const author = aM ? aM[1] : "";
    rows.push({
      tid,
      title,
      excerpt: "",
      posts: replies + 1,
      replies,
      views: null,
      node,
      author,
    });
  }
  return rows;
}

export function parseListFallback(htmlList) {
  const rows = [];
  for (const h of htmlList || []) {
    const idM = h.match(/\/t\/(\d+)/);
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
  return `${HOST}/t/${tid}`;
}

export async function parseTopic(ctx, tid, listMeta = null) {
  const titleHtml = await ctx.xpathAll("//div[@id='Main']//h1");
  const title = titleHtml.length ? stripTags(titleHtml[0]).slice(0, 300) : "";

  const metaHtml = await ctx.xpathAll("//span[@class='count-text']").catch(() => []);
  let pageReplies = null;
  for (const h of metaHtml || []) {
    const m = stripTags(h).match(/(\d+)\s*条回复/);
    if (m) {
      pageReplies = parseIntLoose(m[1]);
      break;
    }
  }

  const opHtml = await ctx.xpathAll("//div[@class='topic_content']");
  const replyHtml = await ctx.xpathAll(
    `(//div[@class='reply_content'])[position() <= ${ctx.cookedLimit - 1}]`,
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
