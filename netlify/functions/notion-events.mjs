const DATA_SOURCE_ID = '3ed401da-165b-80e5-9451-000baea544b7';
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

async function notionRequest(path, token, body, method = 'POST') {
  const response = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Notion request failed (${response.status}).`);
  return response.json();
}

function richText(items) {
  return Array.isArray(items) ? items.map((item) => item.plain_text || item.text?.content || '').join('').trim() : '';
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

export function toPublicEvent(page) {
  const properties = page.properties || {};
  const title = richText(properties['Name of the event']?.title) || 'Untitled event';
  const date = properties.Date?.date;
  const types = properties.Type?.multi_select?.map((option) => option.name) || [];
  const category = types.find((type) => ['Exhibition', 'Talk', 'Workshop', 'Other'].includes(type)) || 'Other';
  const description = richText(properties['Description by yourself (if you don’t use AI put it here)']?.rich_text)
    || richText(properties['AI description']?.rich_text)
    || richText(properties['Description for AI  (optional)']?.rich_text);
  const location = richText(properties['Location ']?.rich_text)
    || properties['Location (1)']?.place?.name
    || properties['Location (1)']?.place?.address
    || '';
  const event = { id: page.id, title, category, date: date?.start?.slice(0, 10) || '', start: date?.start || '', end: date?.end || '', time: '', location, description };
  if (date?.end) event.endDate = date.end.slice(0, 10);
  if (date?.start?.includes('T')) {
    const start = new Date(date.start);
    if (!Number.isNaN(start.getTime())) {
      event.time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(start);
    }
  }

  const eventUrl = safeHttps(properties['Any related website']?.url);
  const poster = properties['Poster (highly recommend)']?.files?.[0];
  const posterUrl = safeHttps(poster?.file?.url || poster?.external?.url);
  if (eventUrl) event.eventUrl = eventUrl;
  const calendarUrl = safeHttps(properties['Google Calendar']?.url);
  if (calendarUrl) event.calendarUrl = calendarUrl;
  if (posterUrl) {
    event.posterUrl = posterUrl;
    event.posterAlt = `Poster for ${title}; event details are listed on this page.`;
  }
  return event;
}

async function queryNotionPages(filter) {
  const token = notionToken();
  if (!token) throw new Error('NOTION_API_KEY is unavailable to the function.');
  const pages = [];
  let startCursor;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await notionRequest(`data_sources/${DATA_SOURCE_ID}/query`, token, {
      page_size: 100,
      ...(filter ? { filter } : {}),
      ...(startCursor ? { start_cursor: startCursor } : {}),
    });
    pages.push(...(result.results || []));
    if (!result.has_more) return pages;
    if (!result.next_cursor) throw new Error('Notion pagination cursor is missing.');
    startCursor = result.next_cursor;
  }
  throw new Error('The Notion event list is too large to load safely.');
}

export const getDoneNotionPages = () => queryNotionPages({ property: 'Select', status: { equals: 'Done' } });
export const getSyncNotionPages = () => queryNotionPages();

export async function updateNotionPage(id, properties) {
  const token = notionToken();
  if (!token) throw new Error('NOTION_API_KEY is unavailable to the function.');
  return notionRequest(`pages/${id}`, token, { properties }, 'PATCH');
}

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  try {
    const events = (await getDoneNotionPages())
      .map(toPublicEvent)
      .filter((event) => event.title !== 'Untitled event');
    return json({ events });
  } catch (error) {
    console.error('Notion event feed failed:', error instanceof Error ? error.message : 'Unknown error');
    return json({ error: 'The Notion event feed is temporarily unavailable.' }, 503);
  }
};
