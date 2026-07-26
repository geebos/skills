import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_EXPORTS = [
  "listTargets",
  "parseListRows",
  "topicUrl",
  "parseTopic",
  "extractLinks",
  "validateArticleUrl",
];

const REQUIRED_SITE_FIELDS = [
  "id",
  "host",
  "listWaitXpath",
  "listRowXpath",
  "topicWaitXpath",
  "selfLinkRe",
];

function configPath() {
  return process.env.DAILY_NEWS_SITES || path.join(SKILL_DIR, "config/sites.json");
}

/**
 * Adapters are loaded eagerly so a malformed one fails at registry load
 * rather than halfway through a scrape.
 */
export async function loadRegistry(file = configPath()) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(raw.sites) || !raw.sites.length) {
    throw new Error(`${file} must define a non-empty sites array`);
  }
  const entries = new Map();
  for (const entry of raw.sites) {
    for (const field of ["id", "name", "adapter"]) {
      if (!entry[field]) throw new Error(`site entry missing ${field} in ${file}`);
    }
    if (entries.has(entry.id)) throw new Error(`duplicate site id ${entry.id}`);
    const adapterPath = path.resolve(SKILL_DIR, entry.adapter);
    const module = await import(pathToFileURL(adapterPath).href);
    for (const name of REQUIRED_EXPORTS) {
      if (typeof module[name] !== "function") {
        throw new Error(`adapter ${entry.adapter} must export function ${name}`);
      }
    }
    if (!module.site) throw new Error(`adapter ${entry.adapter} must export a site object`);
    for (const field of REQUIRED_SITE_FIELDS) {
      if (module.site[field] === undefined) {
        throw new Error(`adapter ${entry.adapter} site.${field} is required`);
      }
    }
    if (module.site.id !== entry.id) {
      throw new Error(`adapter ${entry.adapter} declares id ${module.site.id}, registry says ${entry.id}`);
    }
    entries.set(entry.id, {
      id: entry.id,
      name: entry.name,
      label: entry.label ?? entry.name,
      enabled: entry.enabled !== false,
      adapterPath: entry.adapter,
      badge: entry.badge ?? null,
      requiredConclusionText: entry.requiredConclusionText ?? null,
      ...module,
      ...module.site,
      listTargets: module.listTargets,
      parseListRows: module.parseListRows,
      filterListRow: module.filterListRow ?? null,
      topicUrl: module.topicUrl,
      parseTopic: module.parseTopic,
      extractLinks: module.extractLinks,
      validateArticleUrl: module.validateArticleUrl,
      listMetaFields: module.site.listMetaFields ?? [],
    });
  }
  return makeRegistry(entries);
}

function makeRegistry(entries) {
  return {
    get(id) {
      return entries.get(id) ?? null;
    },
    require(id) {
      const site = entries.get(id);
      if (!site) {
        throw new Error(
          `unknown site ${id}; known: ${[...entries.keys()].join(", ")}`,
        );
      }
      return site;
    },
    all() {
      return [...entries.values()];
    },
    enabled() {
      return [...entries.values()].filter((site) => site.enabled);
    },
    ids() {
      return [...entries.keys()];
    },
  };
}

