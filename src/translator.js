import OpenAI from 'openai';

const instructions = `請將 RSS 文章欄位翻譯成繁體中文，使用台灣自然用語。
不要摘要，不要改寫，不要補充，不要加入評論。
金融、科技、公司名稱、產品名稱若已有常見中文譯名可使用，否則保留英文。
description 可能是空字串；若 title 已經是中文，可原樣保留。
輸入內容已轉成純文字，輸出也必須是純文字，不要加入 HTML。
每個輸入 id 必須原樣輸出一次，不可遺漏、重複或修改 id。`;

const translationSchema = {
  type: 'object',
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' }
        },
        required: ['id', 'title', 'description'],
        additionalProperties: false
      }
    }
  },
  required: ['translations'],
  additionalProperties: false
};

function validateTranslations(inputItems, translations) {
  if (!Array.isArray(translations) || translations.length !== inputItems.length) {
    throw new Error('OpenAI returned an unexpected number of translations.');
  }
  const expectedIds = new Set(inputItems.map((item) => item.id));
  const result = new Map();
  for (const item of translations) {
    if (!item || !expectedIds.has(item.id) || result.has(item.id)
      || typeof item.title !== 'string' || typeof item.description !== 'string') {
      throw new Error('OpenAI returned an invalid translation batch.');
    }
    result.set(item.id, item);
  }
  return result;
}

export function createTranslator({ apiKey, model }) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required. Add it to .env.');
  const client = new OpenAI({ apiKey });

  return async (items) => {
    if (items.length === 0) return new Map();
    const response = await client.responses.create({
      model,
      instructions,
      input: JSON.stringify({ articles: items }),
      text: {
        format: {
          type: 'json_schema',
          name: 'rss_translation_batch',
          strict: true,
          schema: translationSchema
        }
      }
    });

    if (!response.output_text) throw new Error('OpenAI returned no translation text.');
    const result = JSON.parse(response.output_text);
    return validateTranslations(items, result.translations);
  };
}
