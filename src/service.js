import Parser from 'rss-parser';
import { readFile } from 'node:fs/promises';
import { atomicWrite, readJson, validateFeeds, validateState } from './files.js';
import { buildRss, parseRss } from './rss.js';
import { readableText, removeSourceFooter } from './text.js';

const emptyState = () => ({ version: 2, translated: [] });

function itemTime(item) {
  const published = Date.parse(item.pubDate);
  return Number.isNaN(published) ? 0 : published;
}

function itemIdentity(item) {
  const guid = typeof item.guid === 'string' ? item.guid.trim() : '';
  const link = typeof item.link === 'string' ? item.link.trim() : '';
  return guid || link || undefined;
}

async function readExistingXml(filePath) {
  try {
    return parseRss(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(`Cannot read valid RSS from ${filePath}: ${error.message}`, { cause: error });
  }
}

function migrateLegacyState(state, feeds, xmlItems) {
  if (state.version === 2) return xmlItems;
  const urlByName = new Map(feeds.map((feed) => [feed.name, feed.url]));
  const legacyItems = state.items.map((item) => ({
    id: item.id,
    link: item.link,
    pubDate: item.pubDate,
    title: item.title,
    description: item.description,
    source: item.source,
    sourceUrl: urlByName.get(item.source) ?? ''
  })).filter((item) => item.id && item.link && item.sourceUrl);
  return legacyItems.length > 0 ? legacyItems : xmlItems;
}

export async function runOnce(config, { parser = new Parser(), translateBatch, logger = console, now = () => new Date() } = {}) {
  const feeds = validateFeeds(await readJson(config.feedsPath));
  const loadedState = validateState(await readJson(config.statePath, emptyState()));
  const xmlItems = await readExistingXml(config.outputPath);
  let outputItems = migrateLegacyState(loadedState, feeds, xmlItems);
  const configuredUrls = new Set(feeds.map((feed) => feed.url));
  outputItems = outputItems
    .filter((item) => configuredUrls.has(item.sourceUrl))
    .map((item) => ({ ...item, description: removeSourceFooter(item.description, item.source) }));
  const legacyIds = new Set(loadedState.version === 1 ? loadedState.translatedIds : []);
  let translatedEntries = loadedState.version === 2
    ? loadedState.translated.filter((entry) => configuredUrls.has(entry.sourceUrl))
    : [];
  // XML may be one atomic write ahead of JSON after an interrupted run.
  for (const item of outputItems) {
    if (!translatedEntries.some((entry) => entry.id === item.id && entry.sourceUrl === item.sourceUrl)) {
      translatedEntries.push({ id: item.id, source: item.source, sourceUrl: item.sourceUrl });
    }
  }
  let translated = 0;
  let failed = 0;

  for (const source of feeds) {
    let feed;
    try {
      feed = await parser.parseURL(source.url);
    } catch (error) {
      failed += 1;
      logger.error(`[feed] ${source.name}: ${error.message}`);
      continue;
    }

    // Source order is intentional. Slice before all validation and deduplication,
    // so every source item—including an already translated one—uses one slot.
    const currentItems = (feed.items ?? []).slice(0, config.maxItemsPerFeed);
    const existingById = new Map(
      outputItems.filter((item) => item.sourceUrl === source.url).map((item) => [item.id, item])
    );
    const knownIds = new Set([
      ...translatedEntries.filter((entry) => entry.sourceUrl === source.url).map((entry) => entry.id),
      ...legacyIds
    ]);
    const candidates = [];
    const candidateIds = new Set();
    for (const item of currentItems) {
      const id = itemIdentity(item);
      if (!id) {
        logger.warn(`[skip] ${source.name}: item has neither guid nor link`);
        continue;
      }
      if (knownIds.has(id)) continue;
      if (candidateIds.has(id)) continue;
      if (!item.link) {
        logger.warn(`[skip] ${source.name}: ${id} has no link`);
        continue;
      }
      candidates.push({
        id,
        link: item.link,
        pubDate: item.isoDate ?? item.pubDate ?? '',
        title: readableText(item.title),
        description: readableText(item.contentSnippet ?? item.description ?? item.content ?? '')
      });
      candidateIds.add(id);
    }

    let translations = new Map();
    if (candidates.length > 0) {
      try {
        translations = await translateBatch(candidates.map(({ id, title, description }) => ({ id, title, description })));
      } catch (error) {
        failed += candidates.length;
        logger.error(`[translate] ${source.name}: batch of ${candidates.length}: ${error.message}`);
        continue;
      }
    }

    const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const retained = [];
    const retainedEntries = [];
    const retainedIds = new Set();
    for (const item of currentItems) {
      const id = itemIdentity(item);
      if (!id || retainedIds.has(id)) continue;
      const existing = existingById.get(id);
      if (existing) {
        retained.push(existing);
      }
      const original = candidatesById.get(id);
      const result = translations.get(id);
      if (original && result) {
        retained.push({
          id,
          link: original.link,
          pubDate: original.pubDate,
          title: result.title,
          description: result.description.trim(),
          source: source.name,
          sourceUrl: source.url
        });
        translated += 1;
        logger.info(`[translated] ${source.name}: ${id}`);
      }
      if (knownIds.has(id) || result) {
        retainedEntries.push({ id, source: source.name, sourceUrl: source.url });
        retainedIds.add(id);
      }
    }

    outputItems = [
      ...outputItems.filter((item) => item.sourceUrl !== source.url),
      ...retained
    ];
    translatedEntries = [
      ...translatedEntries.filter((entry) => entry.sourceUrl !== source.url),
      ...retainedEntries
    ];
  }

  outputItems.sort((a, b) => itemTime(b) - itemTime(a));
  const state = { version: 2, translated: translatedEntries };
  await atomicWrite(config.outputPath, buildRss(outputItems, now(), config.publicFeedUrl));
  await atomicWrite(config.statePath, `${JSON.stringify(state, null, 2)}\n`);
  return { translated, failed, outputItems: outputItems.length };
}
