import path from 'node:path';

function integer(name, fallback, { min, max } = {}) {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);

  if (!Number.isInteger(value) || (min !== undefined && value < min) || (max !== undefined && value > max)) {
    const range = min !== undefined && max !== undefined ? ` (${min}-${max})` : '';
    throw new Error(`${name} must be an integer${range}.`);
  }
  return value;
}

export function loadConfig(cwd = process.cwd()) {
  const publicFeedUrl = process.env.PUBLIC_FEED_URL || 'https://localhost/rss-t/translated.xml';
  try {
    const url = new URL(publicFeedUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
  } catch {
    throw new Error('PUBLIC_FEED_URL must be a valid HTTP(S) URL.');
  }

  return {
    cwd,
    feedsPath: path.join(cwd, 'feeds.json'),
    statePath: path.join(cwd, 'translated.json'),
    outputPath: path.join(cwd, 'translated.xml'),
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.TRANSLATE_MODEL || 'gpt-5.4-mini',
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL?.trim() ?? '',
    githubPagesToken: process.env.GITHUB_PAGES_TOKEN?.trim() ?? '',
    githubRepository: process.env.GITHUB_REPOSITORY?.trim() ?? '',
    githubPagesBranch: process.env.GITHUB_PAGES_BRANCH?.trim() || 'gh-pages',
    publicFeedUrl,
    pollIntervalMinutes: integer('POLL_INTERVAL_MINUTES', 15, { min: 1 }),
    maxItemsPerFeed: integer('MAX_ITEMS_PER_FEED', 100, { min: 1 })
  };
}
