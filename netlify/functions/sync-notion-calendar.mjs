import { createSign } from 'node:crypto';
import { getSyncNotionPages, toPublicEvent, updateNotionPage } from './notion-events.mjs';

const CALENDAR_ID = 'f9986b287c7b91dce74e53673364bfc7247a882a399a55b4a7027a752d5a6299@group.calendar.google.com';
const API = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`;
const SOURCE = 'uncg-school-of-art-eventboard';
const SITE = 'https://uncg-school-of-art-eventboard.netlify.app';
const base64url = (value) => Buffer.from(value).toString('base64url');

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
  const claim = base64url(JSON.stringify({ iss: credentials.client_email, scope: 'https://www.googleapis.com/auth/calendar.events', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3500 }));
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
  if (!response.ok) throw new Error(`Google Calendar ${method} failed (${response.status}).`);
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
  return { id, summary: event.title, description, location: event.location, start, end, extendedProperties: { private: { source: SOURCE, notionPageId: page.id } } };
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

function comparable(event) {
  const date = (value) => value?.date || (value?.dateTime ? new Date(value.dateTime).toISOString() : '');
  return JSON.stringify([event.summary || '', event.description || '', event.location || '', date(event.start), date(event.end)]);
}

export async function syncCalendar() {
  const [pages, token] = await Promise.all([getSyncNotionPages(), accessToken()]);
  const eligible = pages.filter((page) => ['In progress', 'Done'].includes(page.properties?.Select?.status?.name));
  const desired = new Map(eligible.map((page) => [page, googleEvent(page)]).filter(([, event]) => event).map(([page, event]) => [event.id, { page, event }]));
  const existing = await managedEvents(token);
  const counts = { created: 0, updated: 0, removed: 0, published: 0, withoutCalendar: eligible.length - desired.size };
  for (const [id, { page, event }] of desired) {
    let saved;
    if (!existing.has(id)) {
      saved = await googleRequest(API, token, 'POST', event);
      counts.created += 1;
    } else if (comparable(existing.get(id)) !== comparable(event)) {
      saved = await googleRequest(`${API}/${id}`, token, 'PUT', event);
      counts.updated += 1;
    } else saved = existing.get(id);
    if (!saved?.htmlLink) throw new Error('Google Calendar did not return an event link.');
    const siteUrl = `${SITE}/#event-${page.id}`;
    const props = page.properties || {};
    const currentId = (props['Google Event ID']?.rich_text || []).map((item) => item.plain_text || item.text?.content || '').join('');
    if (props.Select?.status?.name !== 'Done' || props['Google Calendar']?.url !== saved.htmlLink || props['Eventboard page']?.url !== siteUrl || currentId !== id) {
      await updateNotionPage(page.id, {
        Select: { status: { name: 'Done' } },
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
    const id = `notion${page.id.replaceAll('-', '').toLowerCase()}`;
    if (desired.has(id)) continue;
    const oldId = (props['Google Event ID']?.rich_text || []).map((item) => item.plain_text || item.text?.content || '').join('');
    const publishWithoutDate = ['In progress', 'Done'].includes(props.Select?.status?.name)
      && toPublicEvent(page).title !== 'Untitled event';
    const siteUrl = publishWithoutDate ? `${SITE}/#event-${page.id}` : null;
    if (oldId || props['Google Calendar']?.url || (props['Eventboard page']?.url || null) !== siteUrl || (publishWithoutDate && props.Select?.status?.name !== 'Done')) {
      await updateNotionPage(page.id, {
        ...(publishWithoutDate && props.Select?.status?.name !== 'Done' ? { Select: { status: { name: 'Done' } } } : {}),
        'Google Event ID': { rich_text: [] },
        'Google Calendar': { url: null },
        'Eventboard page': { url: siteUrl },
      });
      if (publishWithoutDate && props.Select?.status?.name !== 'Done') counts.published += 1;
    }
  }
  return counts;
}

export default async () => {
  const configured = globalThis.Netlify?.env?.get('GOOGLE_SERVICE_ACCOUNT_JSON') || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!configured) return new Response(JSON.stringify({ skipped: 'Google Calendar write credentials are not configured on Netlify.' }), { headers: { 'Content-Type': 'application/json' } });
  try {
    const counts = await syncCalendar();
    console.log('Notion to Google Calendar sync:', counts);
    return new Response(JSON.stringify(counts), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Notion to Google Calendar sync failed:', error instanceof Error ? error.message : 'Unknown error');
    return new Response('Calendar sync failed.', { status: 503 });
  }
};

export const config = { schedule: '*/15 * * * *' };
