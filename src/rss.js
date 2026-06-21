import { create, convert } from 'xmlbuilder2';
import he from 'he';

function text(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value['#'] === 'string') return value['#'];
  return '';
}

function validDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toUTCString();
}

export function parseRss(xml) {
  if (!xml) return [];
  const document = convert(xml, { format: 'object' });
  const rawItems = document?.rss?.channel?.item;
  const items = rawItems ? (Array.isArray(rawItems) ? rawItems : [rawItems]) : [];

  return items.map((item) => {
    const media = item['media:content'];
    const imageUrl = media?.['@url'] ?? item['media:thumbnail']?.['@url'];
    return {
      id: text(item.guid),
      link: text(item.link),
      pubDate: text(item.pubDate),
      title: text(item.title),
      description: text(item.description),
      source: text(item.source),
      sourceUrl: item.source?.['@url'] ?? '',
      image: imageUrl ? {
        url: imageUrl,
        type: media?.['@type'],
        width: Number(media?.['@width']) || undefined,
        height: Number(media?.['@height']) || undefined
      } : undefined
    };
  }).filter((item) => item.id && item.link);
}

export function buildRss(items, buildDate = new Date(), channelLink = 'https://localhost/rss-t/translated.xml') {
  const root = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('rss', {
      version: '2.0',
      'xmlns:content': 'http://purl.org/rss/1.0/modules/content/',
      'xmlns:dc': 'http://purl.org/dc/elements/1.1/',
      'xmlns:media': 'http://search.yahoo.com/mrss/'
    })
    .ele('channel');

  root.ele('title').txt('rss-t 繁體中文翻譯').up();
  root.ele('link').txt(channelLink).up();
  root.ele('description').txt('多來源 RSS 的繁體中文（台灣）翻譯').up();
  root.ele('language').txt('zh-TW').up();
  root.ele('lastBuildDate').txt(buildDate.toUTCString()).up();

  for (const item of items) {
    const element = root.ele('item');
    element.ele('title').txt(item.title).up();
    element.ele('link').txt(item.link).up();
    element.ele('guid', { isPermaLink: 'false' }).txt(item.id).up();
    const pubDate = validDate(item.pubDate);
    if (pubDate) element.ele('pubDate').txt(pubDate).up();
    element.ele('source', { url: item.sourceUrl }).txt(item.source).up();
    element.ele('dc:creator').txt(item.source).up();
    element.ele('description').txt(item.description).up();
    if (item.image?.url) {
      const mediaAttributes = { url: item.image.url, medium: 'image' };
      if (item.image.type) mediaAttributes.type = item.image.type;
      if (item.image.width) mediaAttributes.width = String(item.image.width);
      if (item.image.height) mediaAttributes.height = String(item.image.height);
      element.ele('media:content', mediaAttributes).up();
      element.ele('media:thumbnail', { url: item.image.url }).up();
      const body = `<p><img src="${he.escape(item.image.url)}" alt=""></p><p>${he.escape(item.description).replace(/\n/g, '<br>')}</p>`;
      element.ele('content:encoded').dat(body).up();
    }
  }

  return root.end({ prettyPrint: true });
}
