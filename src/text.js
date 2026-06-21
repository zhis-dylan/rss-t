import he from 'he';

export function readableText(value) {
  if (typeof value !== 'string' || !value.trim()) return '';

  const withoutUnsafeBlocks = value
    .replace(/<(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ');
  const withBreaks = withoutUnsafeBlocks.replace(/<\s*br\s*\/?\s*>|<\/(p|div|li|h[1-6])\s*>/gi, '\n');
  return he.decode(withBreaks.replace(/<[^>]*>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function removeSourceFooter(value, sourceName) {
  if (typeof value !== 'string') return '';
  const escapedSource = sourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const footer = new RegExp(`(?:^|(?:\\r?\\n){2})(?:原文|文章)來源[：:]\\s*${escapedSource}\\s*$`);
  return value.replace(footer, '').trim();
}
