const MAX_HEADER_LENGTH = 150;
const MAX_SECTION_LENGTH = 3000;

function truncate(text, maxLength) {
  const value = String(text ?? '').trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function messagePayload(item) {
  const title = truncate(item.title || item.link, MAX_HEADER_LENGTH);
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: title, emoji: true }
    },
    {
      type: 'context',
      elements: [{ type: 'plain_text', text: item.source, emoji: true }]
    }
  ];

  if (item.image?.url) {
    blocks.push({
      type: 'image',
      image_url: item.image.url,
      alt_text: truncate(item.title || `${item.source} article image`, 2000)
    });
  }

  if (item.description) {
    blocks.push({
      type: 'section',
      text: {
        type: 'plain_text',
        text: truncate(item.description, MAX_SECTION_LENGTH),
        emoji: false
      }
    });
  }

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `<${item.link}|閱讀原文>` }
  });

  return {
    text: `${item.source}：${item.title}\n${item.link}`,
    blocks,
    unfurl_links: false,
    unfurl_media: false
  };
}

export function createSlackNotifier({ slackWebhookUrl }) {
  if (!slackWebhookUrl) return undefined;

  return async (item) => {
    const response = await fetch(slackWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(messagePayload(item)),
      signal: AbortSignal.timeout(15_000)
    });

    if (!response.ok) {
      const detail = truncate(await response.text(), 500);
      throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }
  };
}

export { messagePayload };
