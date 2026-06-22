import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { create } from 'xmlbuilder2';
import { createFeedParser, runOnce } from '../src/service.js';
import { buildRss, parseRss } from '../src/rss.js';
import { readableText } from '../src/text.js';
import { extractImage } from '../src/image.js';
import { messagePayload } from '../src/slack.js';
import { blobSha, createGitHubPagesPublisher } from '../src/pages.js';

const quiet = { info() {}, warn() {}, error() {} };

async function fixture(feeds = [{ name: 'Example & News', url: 'https://example.com/rss' }]) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'rss-t-'));
  const config = {
    feedsPath: path.join(cwd, 'feeds.json'),
    statePath: path.join(cwd, 'translated.json'),
    outputPath: path.join(cwd, 'translated.xml'),
    maxItemsPerFeed: 100
  };
  await writeFile(config.feedsPath, JSON.stringify(feeds));
  return { cwd, config };
}

function translatedItem(id, source = 'Example & News', sourceUrl = 'https://example.com/rss') {
  return {
    id,
    link: `https://example.com/${id}`,
    pubDate: '2026-01-02T03:04:05Z',
    title: `中文 ${id}`,
    description: `內容 ${id}`,
    source,
    sourceUrl
  };
}

async function seed(config, items) {
  await writeFile(config.outputPath, buildRss(items));
  await writeFile(config.statePath, JSON.stringify({
    version: 2,
    translated: items.map(({ id, source, sourceUrl }) => ({ id, source, sourceUrl }))
  }));
}

function batchTranslator(calls = []) {
  return async (items) => {
    calls.push(items);
    return new Map(items.map((item) => [item.id, {
      id: item.id,
      title: `中：${item.title}`,
      description: `中：${item.description}`
    }]));
  };
}

test('batch translates new items and stores content only in RSS', async () => {
  const { config } = await fixture();
  const parser = { parseURL: async () => ({ items: [
    {
      guid: 'id&1',
      link: 'https://example.com/?a=1&b=2',
      title: 'Hello',
      contentSnippet: 'World',
      isoDate: '2026-01-02T03:04:05Z',
      mediaContent: [{ $: { url: 'https://example.com/hero.jpg', type: 'image/jpeg', width: '1200', height: '630' } }]
    },
    { guid: 'id-2', link: 'https://example.com/2', title: 'Second', description: '<b>Body</b>' }
  ] }) };
  const calls = [];

  const result = await runOnce(config, { parser, translateBatch: batchTranslator(calls), logger: quiet });
  const xml = await readFile(config.outputPath, 'utf8');
  const state = JSON.parse(await readFile(config.statePath, 'utf8'));

  assert.equal(result.translated, 2);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].map((item) => item.id), ['id&1', 'id-2']);
  assert.match(xml, /<source url="https:\/\/example.com\/rss">Example &amp; News<\/source>/);
  assert.match(xml, /<dc:creator>Example &amp; News<\/dc:creator>/);
  assert.match(xml, /<media:content url="https:\/\/example.com\/hero.jpg" medium="image" type="image\/jpeg" width="1200" height="630"\/>/);
  assert.match(xml, /<media:thumbnail url="https:\/\/example.com\/hero.jpg"\/>/);
  assert.match(xml, /<content:encoded><!\[CDATA\[<p><img src="https:\/\/example.com\/hero.jpg"/);
  assert.doesNotMatch(xml, /原文來源|文章來源/);
  assert.doesNotThrow(() => create(xml));
  assert.deepEqual(Object.keys(state), ['version', 'translated']);
  assert.deepEqual(Object.keys(state.translated[0]), ['id', 'source', 'sourceUrl']);
  assert.equal(JSON.stringify(state).includes('中：'), false);
});

test('pushes every newly translated item to Slack', async () => {
  const { config } = await fixture();
  const sent = [];
  const parser = { parseURL: async () => ({ items: [
    { guid: 'new-1', link: 'https://example.com/1', title: 'One' },
    { guid: 'new-2', link: 'https://example.com/2', title: 'Two' }
  ] }) };

  const result = await runOnce(config, {
    parser,
    translateBatch: batchTranslator(),
    notifySlack: async (item) => sent.push(item),
    logger: quiet
  });

  assert.deepEqual(sent.map((item) => item.id), ['new-1', 'new-2']);
  assert.equal(result.slackSent, 2);
  assert.equal(result.slackFailed, 0);
});

test('Slack failure is logged but translated item is still saved', async () => {
  const { config } = await fixture();
  const errors = [];
  const result = await runOnce(config, {
    parser: { parseURL: async () => ({ items: [
      { guid: 'slack-fail', link: 'https://example.com/fail', title: 'Still save me' }
    ] }) },
    translateBatch: batchTranslator(),
    notifySlack: async () => { throw new Error('Slack unavailable'); },
    logger: { ...quiet, error(message) { errors.push(message); } }
  });

  assert.equal(result.translated, 1);
  assert.equal(result.slackFailed, 1);
  assert.match(errors[0], /slack-fail failed: Slack unavailable/);
  assert.deepEqual(parseRss(await readFile(config.outputPath, 'utf8')).map((item) => item.id), ['slack-fail']);
});

test('Slack payload contains translated content, source, link and image', () => {
  const payload = messagePayload({
    title: '中文標題',
    description: '中文內容',
    source: 'Example News',
    link: 'https://example.com/article',
    image: { url: 'https://example.com/image.jpg' }
  });

  assert.equal(payload.text, 'Example News：中文標題\nhttps://example.com/article');
  assert.deepEqual(payload.blocks.map((block) => block.type), ['header', 'context', 'image', 'section', 'section']);
  assert.equal(payload.blocks[2].image_url, 'https://example.com/image.jpg');
  assert.equal(payload.blocks[3].text.text, '中文內容');
  assert.equal(payload.blocks[4].text.text, '<https://example.com/article|閱讀原文>');
});

test('GitHub Pages publisher skips an unchanged XML file', async () => {
  const { config } = await fixture();
  const xml = buildRss([translatedItem('same-pages')]);
  await writeFile(config.outputPath, xml);
  Object.assign(config, {
    githubPagesToken: 'test-token',
    githubRepository: 'owner/repository',
    githubPagesBranch: 'gh-pages'
  });
  const requests = [];
  const publish = createGitHubPagesPublisher(config, {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ sha: blobSha(Buffer.from(xml)) }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  assert.equal(await publish(), 'unchanged');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /contents\/translated\.xml\?ref=gh-pages$/);
});

test('GitHub Pages publisher updates a changed XML file', async () => {
  const { config } = await fixture();
  const xml = buildRss([translatedItem('new-pages')]);
  await writeFile(config.outputPath, xml);
  Object.assign(config, {
    githubPagesToken: 'test-token',
    githubRepository: 'owner/repository',
    githubPagesBranch: 'gh-pages'
  });
  const requests = [];
  const responses = [
    new Response(JSON.stringify({ sha: 'old-sha' }), { status: 200 }),
    new Response(JSON.stringify({ commit: { sha: 'new-commit' } }), { status: 200 })
  ];
  const publish = createGitHubPagesPublisher(config, {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return responses.shift();
    }
  });

  assert.equal(await publish(), 'published');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].options.method, 'PUT');
  const body = JSON.parse(requests[1].options.body);
  assert.equal(body.branch, 'gh-pages');
  assert.equal(body.sha, 'old-sha');
  assert.equal(Buffer.from(body.content, 'base64').toString(), xml);
});

test('completed IDs use a slot and are not sent again', async () => {
  const { config } = await fixture();
  await seed(config, [translatedItem('same')]);
  const parser = { parseURL: async () => ({ items: [{ guid: 'same', link: 'https://example.com/same', title: 'One' }] }) };
  let calls = 0;

  await runOnce(config, { parser, translateBatch: async () => { calls += 1; return new Map(); }, logger: quiet });
  assert.equal(calls, 0);
  assert.equal(parseRss(await readFile(config.outputPath, 'utf8')).length, 1);
});

test('failed batch is not recorded and can retry', async () => {
  const { config } = await fixture();
  const parser = { parseURL: async () => ({ items: [{ link: 'https://example.com/retry', title: 'Retry' }] }) };
  await runOnce(config, { parser, translateBatch: async () => { throw new Error('temporary'); }, logger: quiet });
  const failedState = JSON.parse(await readFile(config.statePath, 'utf8'));
  assert.deepEqual(failedState.translated, []);

  const retried = await runOnce(config, { parser, translateBatch: batchTranslator(), logger: quiet });
  assert.equal(retried.translated, 1);
});

test('per-feed limit counts existing IDs and ignores later items', async () => {
  const { config } = await fixture();
  const existing = Array.from({ length: 95 }, (_, index) => translatedItem(`id-${index}`));
  await seed(config, existing);
  const items = Array.from({ length: 101 }, (_, index) => ({
    guid: `id-${index}`,
    link: `https://example.com/${index}`,
    title: `Title ${index}`,
    isoDate: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
  }));
  const calls = [];

  const result = await runOnce(config, {
    parser: { parseURL: async () => ({ items }) },
    translateBatch: batchTranslator(calls),
    logger: quiet
  });

  assert.equal(result.outputItems, 100);
  assert.deepEqual(calls[0].map((item) => item.id), ['id-95', 'id-96', 'id-97', 'id-98', 'id-99']);
  assert.equal((await readFile(config.outputPath, 'utf8')).includes('id-100'), false);
});

test('removes source items no longer present in its first 100', async () => {
  const { config } = await fixture();
  await seed(config, [translatedItem('keep'), translatedItem('remove')]);

  const messages = [];
  await runOnce(config, {
    parser: { parseURL: async () => ({ items: [{ guid: 'keep', link: 'https://example.com/keep' }] }) },
    translateBatch: batchTranslator(),
    logger: { ...quiet, info(message) { messages.push(message); } }
  });

  assert.deepEqual(parseRss(await readFile(config.outputPath, 'utf8')).map((item) => item.id), ['keep']);
  const state = JSON.parse(await readFile(config.statePath, 'utf8'));
  assert.deepEqual(state.translated.map((item) => item.id), ['keep']);
  assert.deepEqual(messages, ['[feed] Example & News: added=0 removed=1 total=1']);
});

test('feed failure preserves that source previous items', async () => {
  const { config } = await fixture();
  await seed(config, [translatedItem('keep')]);
  const result = await runOnce(config, {
    parser: { parseURL: async () => { throw new Error('offline'); } },
    translateBatch: batchTranslator(),
    logger: quiet
  });

  assert.equal(result.failed, 1);
  assert.deepEqual(parseRss(await readFile(config.outputPath, 'utf8')).map((item) => item.id), ['keep']);
});

test('JSON-only completed ID is not translated or invented in XML', async () => {
  const { config } = await fixture();
  await writeFile(config.statePath, JSON.stringify({
    version: 2,
    translated: [{ id: 'known', source: 'Example & News', sourceUrl: 'https://example.com/rss' }]
  }));
  let calls = 0;

  await runOnce(config, {
    parser: { parseURL: async () => ({ items: [{ guid: 'known', link: 'https://example.com/known' }] }) },
    translateBatch: async () => { calls += 1; return new Map(); },
    logger: quiet
  });

  assert.equal(calls, 0);
  assert.equal(parseRss(await readFile(config.outputPath, 'utf8')).length, 0);
  const state = JSON.parse(await readFile(config.statePath, 'utf8'));
  assert.deepEqual(state.translated.map((item) => item.id), ['known']);
});

test('removes legacy source footer while keeping the source element', async () => {
  const { config } = await fixture();
  const oldItem = { ...translatedItem('old'), description: '翻譯內容\n\n原文來源：Example & News' };
  await seed(config, [oldItem]);

  await runOnce(config, {
    parser: { parseURL: async () => ({ items: [{ guid: 'old', link: oldItem.link }] }) },
    translateBatch: batchTranslator(),
    logger: quiet
  });

  const xml = await readFile(config.outputPath, 'utf8');
  assert.doesNotMatch(xml, /原文來源/);
  assert.match(xml, /<description>翻譯內容<\/description>/);
  assert.match(xml, /<source url="https:\/\/example.com\/rss">Example &amp; News<\/source>/);
});

test('migrates legacy state without retranslating retained content', async () => {
  const { config } = await fixture();
  const legacy = translatedItem('legacy');
  const { sourceUrl: _sourceUrl, ...legacyWithoutUrl } = legacy;
  await writeFile(config.statePath, JSON.stringify({
    version: 1,
    translatedIds: ['legacy', 'evicted-id'],
    items: [legacyWithoutUrl]
  }));

  let calls = 0;
  await runOnce(config, {
    parser: { parseURL: async () => ({ items: [{ guid: 'legacy', link: legacy.link }] }) },
    translateBatch: async () => { calls += 1; return new Map(); },
    logger: quiet
  });

  const state = JSON.parse(await readFile(config.statePath, 'utf8'));
  assert.equal(calls, 0);
  assert.deepEqual(state, {
    version: 2,
    translated: [{ id: 'legacy', source: 'Example & News', sourceUrl: 'https://example.com/rss' }]
  });
});

test('removes unsafe HTML and keeps readable text', () => {
  assert.equal(readableText('<p>Hello &amp; hi</p><script>alert(1)</script><br>Next'), 'Hello & hi\n\nNext');
});

test('extracts common feed image formats and rejects unsafe URLs', async () => {
  assert.deepEqual(extractImage({ enclosure: { url: 'https://example.com/photo.png', type: 'image/png' } }), {
    url: 'https://example.com/photo.png',
    type: 'image/png'
  });
  assert.deepEqual(extractImage({ description: '<p>Text</p><img src="https://example.com/from-html.webp">' }), {
    url: 'https://example.com/from-html.webp',
    type: 'image/webp'
  });
  assert.equal(extractImage({ description: '<img src="javascript:alert(1)">' }), undefined);
  assert.deepEqual(extractImage({
    mediaContent: [{ $: { url: 'https://media.zenfs.com/en/source/hash-without-extension', width: '130', height: '86' } }]
  }), {
    url: 'https://media.zenfs.com/en/source/hash-without-extension',
    type: undefined,
    width: 130,
    height: 86
  });

  const parser = createFeedParser();
  const feed = await parser.parseString(`<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Feed</title><link>https://example.com</link><description>Feed</description><item><title>Item</title><link>https://example.com/item</link><media:thumbnail url="https://example.com/thumb.jpg" /></item></channel></rss>`);
  assert.deepEqual(extractImage(feed.items[0]), {
    url: 'https://example.com/thumb.jpg',
    type: 'image/jpeg',
    width: undefined,
    height: undefined
  });
});
