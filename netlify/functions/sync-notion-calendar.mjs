import { createSign } from 'node:crypto';
import { isIP } from 'node:net';
import { createNotionEvent, getSyncNotionPages, toPublicEvent, updateNotionPage, uploadNotionPoster } from './notion-events.mjs';

const CALENDAR_ID = 'f9986b287c7b91dce74e53673364bfc7247a882a399a55b4a7027a752d5a6299@group.calendar.google.com';
const API = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`;
const SOURCE = 'uncg-school-of-art-eventboard';
const SITE = 'https://uncg-event.com';
const base64url = (value) => Buffer.from(value).toString('base64url');
const GOOGLE_EVENT_COLOR_BY_NOTION_COLOR = {
  default: '8', gray: '8', brown: '6', orange: '6', yellow: '5', green: '10',
  blue: '9', purple: '3', pink: '4', red: '11',
};
const googleColorId = (event) => GOOGLE_EVENT_COLOR_BY_NOTION_COLOR[event.tagColors?.[event.tags[0]]];

function exclusiveEnd(date) {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

async function accessToken() {
  const raw = globalThis.Netlify?.env?.get('GOOGLE_SERVICE_ACCOUNT_JSON') || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not configured.');
  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.');
  }
  if (credentials.type !== 'service_account' || !credentials.client_email || !credentials.private_key) throw new Error('Google service account credentials are incomplete.');
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({ iss: credentials.client_email, scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3500 }));
  const unsigned = `${header}.${claim}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const assertion = `${unsigned}.${signer.sign(credentials.private_key.replace(/\\n/g, '\n')).toString('base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) throw new Error(`Google authorization failed (${response.status}).`);
  return (await response.json()).access_token;
}

async function googleRequest(url, token, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const reason = failure.error?.errors?.[0]?.reason;
    throw new Error(`Google Calendar ${method} failed (${response.status}${reason ? `: ${reason}` : ''}).`);
  }
  return response.status === 204 ? null : response.json();
}

function googleEvent(page) {
  const event = toPublicEvent(page);
  if (!event.start || event.title === 'Untitled event') return null;
  const id = `notion${page.id.replaceAll('-', '').toLowerCase()}`;
  const allDay = !event.start.includes('T');
  const start = allDay ? { date: event.date } : { dateTime: event.start, timeZone: 'America/New_York' };
  let end;
  if (allDay) end = { date: exclusiveEnd(event.end || event.date) };
  else if (event.end && event.end.includes('T')) end = { dateTime: event.end, timeZone: 'America/New_York' };
  else {
    const startTime = new Date(event.start);
    if (Number.isNaN(startTime.getTime())) return null;
    end = { dateTime: new Date(startTime.getTime() + 60 * 60 * 1000).toISOString(), timeZone: 'America/New_York' };
  }
  const unique = page.properties?.ID?.unique_id;
  const reference = unique?.number ? `Notion ID: ${unique.prefix || ''}${unique.number}` : '';
  const siteUrl = `${SITE}/#event-${page.id}`;
  const description = [event.description, event.eventUrl, reference, `View on Eventboard: ${siteUrl}`].filter(Boolean).join('\n\n');
  const colorId = googleColorId(event);
  return { id, summary: event.title, description, location: event.location, start, end, ...(colorId ? { colorId } : {}), extendedProperties: { private: { source: SOURCE, notionPageId: page.id } } };
}

async function managedEvents(token) {
  const events = new Map();
  let pageToken;
  do {
    const url = new URL(API);
    url.searchParams.set('privateExtendedProperty', `source=${SOURCE}`);
    url.searchParams.set('maxResults', '2500');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const result = await googleRequest(url, token);
    for (const event of result.items || []) events.set(event.id, event);
    pageToken = result.nextPageToken;
  } while (pageToken);
  return events;
}

async function allCalendarEvents(token) {
  const events = [];
  let pageToken;
  do {
    const url = new URL(API);
    url.searchParams.set('maxResults', '2500');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const result = await googleRequest(url, token);
    events.push(...(result.items || []));
    pageToken = result.nextPageToken;
  } while (pageToken);
  return events;
}

const propertyText = (property) => (property?.rich_text || []).map((part) => part.plain_text || part.text?.content || '').join('');
const textProperty = (value) => ({ rich_text: value ? [{ text: { content: value.slice(0, 2000) } }] : [] });

function descriptionLinks(description) {
  const urls = [...String(description || '').matchAll(/https:\/\/[^\s<>"']+/gi)]
    .map((match) => match[0].replace(/[),.;]+$/, ''));
  const safe = urls.filter((value) => {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if (url.protocol !== 'https:' || host === 'localhost' || host.endsWith('.local')) return false;
      if (isIP(host)) {
        if (host.includes(':')) return !/^(?:fe80:|fc|fd|::1$|::$)/i.test(host);
        const [a, b] = host.split('.').map(Number);
        return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
          || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
      }
      return true;
    } catch { return false; }
  });
  const image = safe.find((url) => /\.(?:png|jpe?g|webp|gif)(?:[?#]|$)/i.test(url));
  const website = safe.find((url) => url !== image && !['uncg-event.com', 'www.uncg-event.com', 'uncg-school-of-art-eventboard.netlify.app'].includes(new URL(url).hostname.toLowerCase()));
  return { image, website };
}

function notionDate(event) {
  const start = event.start?.dateTime || event.start?.date;
  if (!start) return null;
  if (event.start?.date) {
    const end = event.end?.date;
    if (!end) return { start };
    const last = new Date(`${end}T12:00:00Z`);
    last.setUTCDate(last.getUTCDate() - 1);
    const inclusive = last.toISOString().slice(0, 10);
    return inclusive > start ? { start, end: inclusive } : { start };
  }
  return { start, ...(event.end?.dateTime ? { end: event.end.dateTime } : {}) };
}

async function calendarPoster(event, token) {
  const attached = (event.attachments || []).find((item) => /^image\/(?:png|jpeg|webp|gif)$/.test(item.mimeType || '') && item.fileId);
  const imageUrl = descriptionLinks(event.description).image;
  if (!attached && !imageUrl) return null;
  let response;
  let filename;
  if (attached) {
    response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(attached.fileId)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
    filename = attached.title || 'calendar-poster';
  }
  if ((!response?.ok) && imageUrl) {
    response = await fetch(imageUrl, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    filename = new URL(imageUrl).pathname.split('/').pop() || 'calendar-poster';
  }
  if (!response.ok) throw new Error(`Calendar poster could not be read (${response.status}).`);
  const headerMime = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  const mime = headerMime === 'application/octet-stream' ? attached?.mimeType : (headerMime || attached?.mimeType || '');
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[mime];
  if (!extension) throw new Error('Calendar poster is not a supported image.');
  if (Number(response.headers.get('content-length')) > 10 * 1024 * 1024) throw new Error('Calendar poster exceeds 10 MB.');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('Calendar poster exceeds 10 MB.');
  filename = filename.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 100);
  if (!filename.toLowerCase().endsWith(`.${extension}`)) filename = `${filename}.${extension}`;
  return uploadNotionPoster(bytes, filename, mime);
}

async function importCalendarEvent(event, page, token) {
  const title = (event.summary || '').trim();
  if (!title || !notionDate(event)) return null;
  const description = String(event.description || '').replace(/<[^>]+>/g, ' ').trim();
  const { website, image } = descriptionLinks(event.description);
  const current = page?.properties || {};
  const properties = {
    'Name of the event': { title: [{ text: { content: title.slice(0, 2000) } }] },
    Date: { date: notionDate(event) },
    'Location ': textProperty(event.location || ''),
    'Published description': textProperty(description),
    'Any related website': { url: website || null },
    'Google Event ID': textProperty(event.id),
    'Google Calendar': { url: event.htmlLink || null },
    'Source submission': textProperty(`google-calendar:${event.updated || event.etag || event.id}`),
  };
  if (!page) properties.Select = { status: { name: 'Done' } };
  const revision = propertyText(current['Source submission']);
  const changedAtGoogle = !page || revision !== `google-calendar:${event.updated || event.etag || event.id}`;
  if (!changedAtGoogle) return page;
  if ((image || event.attachments?.length) && (!page || changedAtGoogle)) {
    try {
      const poster = await calendarPoster(event, token);
      if (poster) properties['Poster (highly recommend)'] = { files: [poster] };
    } catch (error) {
      console.warn(`Calendar poster import skipped for ${event.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  if (page) {
    return updateNotionPage(page.id, properties);
  }
  const created = await createNotionEvent(properties);
  await updateNotionPage(created.id, { 'Eventboard page': { url: `${SITE}/#event-${created.id}` } });
  return created;
}

function notionChangesForGoogle(page, event) {
  const published = toPublicEvent(page);
  if (!published.start) return null;
  const allDay = !published.start.includes('T');
  const start = allDay ? { date: published.date } : { dateTime: published.start, timeZone: 'America/New_York' };
  const end = allDay ? { date: exclusiveEnd(published.end || published.date) }
    : { dateTime: published.end?.includes('T') ? published.end : new Date(new Date(published.start).getTime() + 3600000).toISOString(), timeZone: 'America/New_York' };
  const description = published.eventUrl && !published.description.includes(published.eventUrl)
    ? [published.description, published.eventUrl].filter(Boolean).join('\n\n') : published.description;
  const colorId = googleColorId(published);
  const desired = { summary: published.title, description, location: published.location, start, end, ...(colorId ? { colorId } : {}) };
  return comparable(desired) === comparable(event) && (!colorId || colorId === event.colorId) ? null : desired;
}

function comparable(event) {
  const date = (value) => value?.date || (value?.dateTime ? new Date(value.dateTime).toISOString() : '');
  return JSON.stringify([event.summary || '', event.description || '', event.location || '', date(event.start), date(event.end)]);
}

export async function syncCalendar() {
  const [pages, token] = await Promise.all([getSyncNotionPages(), accessToken()]);
  const calendarEvents = await allCalendarEvents(token);
  const pagesByGoogleId = new Map(pages.map((page) => [propertyText(page.properties?.['Google Event ID']), page]).filter(([id]) => id));
  const counts = { imported: 0, refreshed: 0, created: 0, updated: 0, removed: 0, published: 0, withoutCalendar: 0 };
  for (const event of calendarEvents) {
    if (event.status === 'cancelled' || (event.eventType && event.eventType !== 'default')) continue;
    if (event.extendedProperties?.private?.source === SOURCE || event.id?.startsWith('notion')) continue;
    const existingPage = pagesByGoogleId.get(event.id);
    let result;
    const revision = propertyText(existingPage?.properties?.['Source submission']);
    if (existingPage && revision === `google-calendar:${event.updated || event.etag || event.id}`) {
      const changes = notionChangesForGoogle(existingPage, event);
      if (changes) {
        const saved = await googleRequest(`${API}/${encodeURIComponent(event.id)}`, token, 'PATCH', changes);
        await updateNotionPage(existingPage.id, { 'Source submission': textProperty(`google-calendar:${saved.updated || saved.etag || saved.id}`) });
        counts.updated += 1;
      }
      result = existingPage;
    } else result = await importCalendarEvent(event, existingPage, token);
    if (result) {
      if (existingPage && result !== existingPage) counts.refreshed += 1;
      if (!existingPage) {
        pages.push(result);
        pagesByGoogleId.set(event.id, result);
        counts.imported += 1;
      }
    }
  }
  const activeCalendarIds = new Set(calendarEvents.filter((event) => event.status !== 'cancelled').map((event) => event.id));
  for (const page of pages) {
    if (!propertyText(page.properties?.['Source submission']).startsWith('google-calendar:')) continue;
    const id = propertyText(page.properties?.['Google Event ID']);
    if (!id || activeCalendarIds.has(id) || page.properties?.Select?.status?.name !== 'Done') continue;
    await updateNotionPage(page.id, { Select: { status: { name: 'In progress' } }, 'Google Calendar': { url: null } });
    counts.removed += 1;
  }
  const eligible = pages.filter((page) => page.properties?.Select?.status?.name === 'Done'
    && (!propertyText(page.properties?.['Google Event ID']) || propertyText(page.properties?.['Google Event ID']).startsWith('notion')));
  const desired = new Map(eligible.map((page) => [page, googleEvent(page)]).filter(([, event]) => event).map(([page, event]) => [event.id, { page, event }]));
  const existing = await managedEvents(token);
  counts.withoutCalendar = eligible.length - desired.size;
  for (const [id, { page, event }] of desired) {
    let saved;
    if (!existing.has(id)) {
      saved = await googleRequest(API, token, 'POST', event);
      counts.created += 1;
    } else if (comparable(existing.get(id)) !== comparable(event)
      || (existing.get(id).colorId || '') !== (event.colorId || '')) {
      saved = await googleRequest(`${API}/${id}`, token, 'PUT', event);
      counts.updated += 1;
    } else saved = existing.get(id);
    if (!saved?.htmlLink) throw new Error('Google Calendar did not return an event link.');
    const siteUrl = `${SITE}/#event-${page.id}`;
    const props = page.properties || {};
    const currentId = (props['Google Event ID']?.rich_text || []).map((item) => item.plain_text || item.text?.content || '').join('');
    if (props['Google Calendar']?.url !== saved.htmlLink || props['Eventboard page']?.url !== siteUrl || currentId !== id) {
      await updateNotionPage(page.id, {
        'Google Event ID': { rich_text: [{ text: { content: id } }] },
        'Google Calendar': { url: saved.htmlLink },
        'Eventboard page': { url: siteUrl },
      });
      counts.published += 1;
    }
  }
  for (const id of existing.keys()) {
    if (!desired.has(id)) {
      await googleRequest(`${API}/${id}`, token, 'DELETE');
      counts.removed += 1;
    }
  }
  for (const page of pages) {
    const props = page.properties || {};
    const externalId = propertyText(props['Google Event ID']);
    if (externalId && !externalId.startsWith('notion')) continue;
    const id = `notion${page.id.replaceAll('-', '').toLowerCase()}`;
    if (desired.has(id)) continue;
    const oldId = (props['Google Event ID']?.rich_text || []).map((item) => item.plain_text || item.text?.content || '').join('');
    const publishWithoutDate = props.Select?.status?.name === 'Done'
      && toPublicEvent(page).title !== 'Untitled event';
    const siteUrl = publishWithoutDate ? `${SITE}/#event-${page.id}` : null;
    if (oldId || props['Google Calendar']?.url || (props['Eventboard page']?.url || null) !== siteUrl) {
      await updateNotionPage(page.id, {
        'Google Event ID': { rich_text: [] },
        'Google Calendar': { url: null },
        'Eventboard page': { url: siteUrl },
      });
      if (publishWithoutDate) counts.published += 1;
    }
  }
  return counts;
}

export default async () => {
  const configured = globalThis.Netlify?.env?.get('GOOGLE_SERVICE_ACCOUNT_JSON') || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!configured) return new Response(JSON.stringify({ skipped: 'Google Calendar write credentials are not configured on Netlify.' }), { headers: { 'Content-Type': 'application/json' } });
  try {
    const counts = await syncCalendar();
    console.log('Notion and Google Calendar sync:', counts);
    return new Response(JSON.stringify(counts), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Notion and Google Calendar sync failed:', error instanceof Error ? error.message : 'Unknown error');
    return new Response('Calendar sync failed.', { status: 503 });
  }
};

export const config = { schedule: '*/15 * * * *' };
