import he from 'he';

function httpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(he.decode(value.trim()));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function attributes(value) {
  return value?.$ ?? value ?? {};
}

function array(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function imageTypeFromUrl(url) {
  const extension = new URL(url).pathname.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' })[extension];
}

function mediaImage(value, thumbnail = false) {
  const data = attributes(value);
  const url = httpUrl(data.url ?? data.href);
  if (!url) return undefined;
  const type = typeof data.type === 'string' ? data.type.toLowerCase() : '';
  const medium = typeof data.medium === 'string' ? data.medium.toLowerCase() : '';
  if (!thumbnail && medium && medium !== 'image' && !type.startsWith('image/')) return undefined;
  if (!thumbnail && !medium && type && !type.startsWith('image/')) return undefined;
  if (!thumbnail && !medium && !type && !imageTypeFromUrl(url)) return undefined;

  const width = Number(data.width);
  const height = Number(data.height);
  if ((Number.isFinite(width) && width <= 2) || (Number.isFinite(height) && height <= 2)) return undefined;
  return {
    url,
    type: type.startsWith('image/') ? type : imageTypeFromUrl(url),
    width: Number.isFinite(width) && width > 0 ? width : undefined,
    height: Number.isFinite(height) && height > 0 ? height : undefined
  };
}

function htmlImage(value) {
  if (typeof value !== 'string') return undefined;
  const match = value.match(/<img\b[^>]*?\bsrc\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/i);
  const url = httpUrl(match?.[2] ?? match?.[3]);
  return url ? { url, type: imageTypeFromUrl(url) } : undefined;
}

export function extractImage(item) {
  for (const value of array(item.mediaContent ?? item['media:content'])) {
    const image = mediaImage(value);
    if (image) return image;
  }
  for (const value of array(item.mediaThumbnail ?? item['media:thumbnail'])) {
    const image = mediaImage(value, true);
    if (image) return image;
  }

  const enclosure = attributes(item.enclosure);
  const enclosureUrl = httpUrl(enclosure.url);
  const enclosureType = typeof enclosure.type === 'string' ? enclosure.type.toLowerCase() : '';
  if (enclosureUrl && (enclosureType.startsWith('image/') || imageTypeFromUrl(enclosureUrl))) {
    return { url: enclosureUrl, type: enclosureType || imageTypeFromUrl(enclosureUrl) };
  }

  return htmlImage(item['content:encoded'])
    ?? htmlImage(item.content)
    ?? htmlImage(item.description);
}
