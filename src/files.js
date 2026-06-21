import { open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`Cannot read valid JSON from ${filePath}: ${error.message}`, { cause: error });
  }
}

export async function atomicWrite(filePath, content) {
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;

  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, filePath);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export function validateFeeds(value) {
  if (!Array.isArray(value)) throw new Error('feeds.json must contain a JSON array.');

  return value.map((feed, index) => {
    if (!feed || typeof feed.name !== 'string' || !feed.name.trim() || typeof feed.url !== 'string') {
      throw new Error(`feeds.json item ${index + 1} must have non-empty name and url strings.`);
    }
    try {
      const url = new URL(feed.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
    } catch {
      throw new Error(`feeds.json item ${index + 1} has an invalid HTTP(S) URL.`);
    }
    return { name: feed.name.trim(), url: feed.url };
  });
}

export function validateState(value) {
  const isLegacy = value?.version === 1 && Array.isArray(value.translatedIds) && Array.isArray(value.items);
  const isCurrent = value?.version === 2 && Array.isArray(value.translated);
  if (!isLegacy && !isCurrent) {
    throw new Error('translated.json must be a supported rss-t state file.');
  }
  return value;
}
