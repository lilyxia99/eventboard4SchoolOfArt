const DATABASE_ID = '3ed401da165b80cb8216d9afa845ef79';
const NOTION_VERSION = '2025-09-03';
const MAX_PAGES = 100;
const RESPONSE_HEADERS = {
  'Cache-Control': 'public, max-age=60, s-maxage=60',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: RESPONSE_HEADERS });

function notionToken() {
  return globalThis.Netlify?.env?.get('NOTION_API_KEY')
    || (typeof process !== 'undefined' ? process.env.NOTION_API_KEY : '');
}

async function notionRequest(path, token, options = {}) {
  const response = await fetch(`https://api.notion.com/v1/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!response.ok) throw new Error(`Notion request failed (${response.status}).`);
  return response.json();
}

function findProperty(properties, aliases = [], types = []) {
  const entries = Object.entries(properties || {});
  const normalizedAliases = aliases.map((name) => name.toLowerCase());
  return entries.find(([name]) => normalizedAliases.includes(name.trim().toLowerCase()))
    || entries.find(([, property]) => types.includes(property.type));
}

function richTextValue(items) {
  return Array.isArray(items) ? items.map((item) => item.plain_text || item.text?.content || '').join('').trim() : '';
}

function propertyValue(property) {
  if (!property) return '';
  switch (property.type) {
    case 'title': return richTextValue(property.title);
    case 'rich_text': return richTextValue(property.rich_text);
    case 'status': return property.status?.name || '';
    case 'select': return property.select?.name || '';
    case 'multi_select': return (property.multi_select || []).map((option) => option.name).join(', ');
    case 'date': return property.date || null;
    case 'url': return property.url || '';
    case 'files': {
      const file = property.files?.[0];
      return file?.file?.url || file?.external?.url || '';
    }
    case 'email': return property.email || '';
    case 'phone_number': return property.phone_number || '';
    case 'number': return property.number == null ? '' : String(property.number);
    case 'formula': {
      const formula = property.formula || {};
      return formula.string ?? formula.boolean ?? formula.number ?? formula.date ?? '';
    }
    default: return '';
  }
}

function firstValue(properties, aliases, types = []) {
  const match = findProperty(properties, aliases, types);
  return match ? propertyValue(properties[match[0]]) : '';
}

function formatNotionTime(dateValue) {
  if (!dateValue || !dateValue.includes('T')) return '';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

function safeHttps(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function toPublicEvent(page) {
  const properties = page.properties || {};
  const dateProperty = findProperty(properties, ['date', 'event date', '活动日期', '日期'], ['date']);
  const dateValue = dateProperty ? propertyValue(properties[dateProperty[0]]) : null;
  const start = typeof dateValue === 'object' && dateValue ? dateValue.start || '' : String(dateValue || '');
  const end = typeof dateValue === 'object' && dateValue ? dateValue.end || '' : '';
  const title = firstValue(properties, ['event title', 'title', 'name', '活动名称', '活动标题'], ['title']);
  const time = firstValue(properties, ['time', 'event time', '活动时间', '时间'], ['rich_text']);
  const categoryValue = firstValue(properties, ['category', 'event type', 'type', '活动类型', '类别'], ['select']);
  const event = {
    title: String(title || '').trim(),
    category: ['Exhibition', 'Talk', 'Workshop', 'Other'].includes(categoryValue) ? categoryValue : 'Other',
    date: start.slice(0, 10),
    time: String(time || formatNotionTime(start)).trim(),
    location: String(firstValue(properties, ['location', 'venue', '地点', '场地'], ['rich_text'])).trim(),
    description: String(firstValue(properties, ['description', 'event description', 'details', '活动介绍', '简介', '说明'], ['rich_text'])).trim(),
  };
  if (end) event.endDate = end.slice(0, 10);

  const eventUrl = safeHttps(firstValue(properties, ['event url', 'event link', 'link', 'website', '活动链接', '链接'], ['url']));
  const posterUrl = safeHttps(firstValue(properties, ['poster', 'event image', 'image', 'flyer', '海报', '活动图片'], ['files']));
  const posterAlt = firstValue(properties, ['poster alt', 'image description', 'alt text', '海报描述', '图片描述'], ['rich_text']);
  if (eventUrl) event.eventUrl = eventUrl;
  if (posterUrl) {
    event.posterUrl = posterUrl;
    event.posterAlt = String(posterAlt || `Poster for ${event.title}`).trim();
  }
  return event;
}

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  const token = notionToken();
  if (!token) return json({ error: 'The Notion event feed is temporarily unavailable.' }, 503);

  try {
    const database = await notionRequest(`databases/${DATABASE_ID}`, token);
    const dataSource = database.data_sources?.[0];
    if (!dataSource?.id) throw new Error('No Notion data source was found.');

    const schema = await notionRequest(`data_sources/${dataSource.id}`, token);
    const statusEntry = Object.entries(schema.properties || {}).find(([, property]) => property.type === 'status')
      || Object.entries(schema.properties || {}).find(([name, property]) => property.type === 'select' && ['status', '状态'].includes(name.trim().toLowerCase()));
    if (!statusEntry) throw new Error('The Notion database needs a Status property.');

    const [statusName, statusProperty] = statusEntry;
    const filter = statusProperty.type === 'status'
      ? { property: statusName, status: { equals: 'Done' } }
      : { property: statusName, select: { equals: 'Done' } };
    const events = [];
    let startCursor;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await notionRequest(`data_sources/${dataSource.id}/query`, token, {
        method: 'POST',
        body: JSON.stringify({ page_size: 100, filter, ...(startCursor ? { start_cursor: startCursor } : {}) }),
      });
      for (const row of result.results || []) {
        if (propertyValue(row.properties?.[statusName]) !== 'Done') continue;
        const event = toPublicEvent(row);
        if (event.title && /^\d{4}-\d{2}-\d{2}$/.test(event.date)) events.push(event);
      }
      if (!result.has_more) return json({ events });
      if (!result.next_cursor) throw new Error('Notion pagination cursor is missing.');
      startCursor = result.next_cursor;
    }
    throw new Error('The Notion event list is too large to load safely.');
  } catch {
    return json({ error: 'The Notion event feed is temporarily unavailable.' }, 503);
  }
};
