export const DATA_SOURCE_ID = '3ed401da-165b-80e5-9451-000baea544b7';
const NOTION_VERSION = '2025-09-03';
const MAX_PAGES = 100;
const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
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
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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

export function toPublicEvent(page, sourcePage) {
  const properties = page.properties || {};
  const title = richText(properties['Name of the event']?.title) || 'Untitled event';
  const date = properties.Date?.date;
  const typeOptions = properties.Type?.multi_select || [];
  const types = typeOptions.map((option) => option.name);
  const tagOptions = [...(properties.Tags?.multi_select || properties.Tag?.multi_select || []), ...typeOptions];
  const tags = [...new Set(tagOptions.map((option) => String(option.name || '').trim()).filter(Boolean))];
  const tagColors = Object.fromEntries([...tagOptions].reverse()
    .filter((option) => tags.includes(String(option.name || '').trim()))
    .map((option) => [String(option.name).trim(), option.color || 'default']));
  const type = types.find((value) => ['Exhibition', 'Workshop', 'Screening', 'Lecture', 'Visiting Artist'].includes(value)) || types[0] || 'Other';
  const category = ['Exhibition', 'Workshop'].includes(type) ? type : type === 'Lecture' || type === 'Visiting Artist' ? 'Talk' : 'Other';
  const description = richText(properties['Published description']?.rich_text)
    || richText(properties['Description by yourself (if you don’t use AI put it here)']?.rich_text)
    || richText(properties['AI description']?.rich_text)
    || richText(properties['Description for AI  (optional)']?.rich_text);
  const location = richText(properties['Location ']?.rich_text)
    || properties['Location (1)']?.place?.name
    || properties['Location (1)']?.place?.address
    || '';
  const event = { id: page.id, title, category, type, tags, tagColors, date: date?.start?.slice(0, 10) || '', start: date?.start || '', end: date?.end || '', time: '', location, description };
  if (date?.end) event.endDate = date.end.slice(0, 10);
  if (date?.start?.includes('T')) {
    const start = new Date(date.start);
    if (!Number.isNaN(start.getTime())) {
      event.time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(start);
    }
  }

  const eventUrl = safeHttps(properties['Any related website']?.url);
  const poster = properties['Poster (highly recommend)']?.files?.[0]
    || sourcePage?.properties?.['Poster (highly recommend)']?.files?.[0];
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

export async function createNotionEvent(properties) {
  const token = notionToken();
  if (!token) throw new Error('NOTION_API_KEY is unavailable to the function.');
  return notionRequest('pages', token, { parent: { type: 'data_source_id', data_source_id: DATA_SOURCE_ID }, properties });
}

export async function uploadNotionPoster(bytes, filename, contentType) {
  const token = notionToken();
  if (!token) throw new Error('NOTION_API_KEY is unavailable to the function.');
  const upload = await notionRequest('file_uploads', token, { mode: 'single_part', filename, content_type: contentType });
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: contentType }), filename);
  const response = await fetch(`https://api.notion.com/v1/file_uploads/${upload.id}/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION },
    body: form,
  });
  if (!response.ok) throw new Error(`Notion poster upload failed (${response.status}).`);
  const saved = await response.json();
  if (saved.status !== 'uploaded') throw new Error('Notion poster upload did not complete.');
  return { name: filename, type: 'file_upload', file_upload: { id: saved.id } };
}

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  try {
    const pages = await getSyncNotionPages();
    const byId = new Map(pages.map((page) => [page.id, page]));
    const events = pages
      .filter((page) => page.properties?.Select?.status?.name === 'Done')
      .map((page) => {
        const sourceId = richText(page.properties?.['Source submission']?.rich_text);
        return toPublicEvent(page, byId.get(sourceId));
      })
      .filter((event) => event.title !== 'Untitled event');
    return json({ events });
  } catch (error) {
    console.error('Notion event feed failed:', error instanceof Error ? error.message : 'Unknown error');
    return json({ error: 'The Notion event feed is temporarily unavailable.' }, 503);
  }
};
