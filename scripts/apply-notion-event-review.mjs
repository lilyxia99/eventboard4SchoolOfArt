import { readFile } from 'node:fs/promises';
import { getSyncNotionPages, updateNotionPage } from '../netlify/functions/notion-events.mjs';

const DATA_SOURCE_ID = '3ed401da-165b-80e5-9451-000baea544b7';
const NOTION_VERSION = '2025-09-03';
const TYPES = new Set(['Exhibition', 'Workshop', 'Screening', 'Lecture', 'Visiting Artist', 'Other']);
const text = (value) => ({ rich_text: value ? [{ text: { content: value } }] : [] });
const richText = (items) => (items || []).map((item) => item.plain_text || item.text?.content || '').join('');
const sameDate = (left, right) => left && right ? Date.parse(left) === Date.parse(right) : !left && !right;

function validateEvent(event) {
  if (!event || typeof event !== 'object') throw new Error('Each reviewed event must be an object.');
  for (const field of ['title', 'type', 'description']) {
    if (typeof event[field] !== 'string' || !event[field].trim() || event[field].length > 1900) throw new Error(`Invalid ${field}.`);
  }
  if (!TYPES.has(event.type)) throw new Error('Unsupported event type.');
  if (event.start && (typeof event.start !== 'string' || Number.isNaN(Date.parse(event.start)))) throw new Error('Invalid start date.');
  if (event.end && (!event.start || typeof event.end !== 'string' || Number.isNaN(Date.parse(event.end)) || Date.parse(event.end) <= Date.parse(event.start))) throw new Error('Invalid end date.');
  if (event.eventUrl && (typeof event.eventUrl !== 'string' || new URL(event.eventUrl).protocol !== 'https:')) throw new Error('Event link must use HTTPS.');
  if (event.location && (typeof event.location !== 'string' || event.location.length > 1900)) throw new Error('Invalid location.');
}

function eventProperties(event, sourceId, number) {
  return {
    'Name of the event': { title: [{ text: { content: event.title.trim() } }] },
    Select: { status: { name: 'In progress' } },
    Type: { multi_select: [{ name: event.type }] },
    Date: { date: event.start ? { start: event.start, ...(event.end ? { end: event.end } : {}) } : null },
    'Location ': text(event.location?.trim() || ''),
    'Published description': text(event.description.trim()),
    ...(Object.hasOwn(event, 'eventUrl') ? { 'Any related website': { url: event.eventUrl || null } } : {}),
    'Source submission': text(sourceId),
    'Source event number': { number },
  };
}

async function createPage(properties) {
  const token = process.env.NOTION_API_KEY;
  if (!token) throw new Error('NOTION_API_KEY is missing.');
  const response = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent: { type: 'data_source_id', data_source_id: DATA_SOURCE_ID }, properties }),
  });
  if (!response.ok) throw new Error(`Notion page creation failed (${response.status}).`);
  return response.json();
}

const inputPath = process.argv[2];
if (!inputPath) throw new Error('Pass a private JSON review file path.');
const review = JSON.parse(await readFile(inputPath, 'utf8'));
if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(review.sourcePageId || '')) throw new Error('Invalid source page ID.');
if (!Array.isArray(review.events) || review.events.length === 0 || review.events.length > 20) throw new Error('Expected 1 to 20 reviewed events.');
review.events.forEach(validateEvent);

const pages = await getSyncNotionPages();
const source = pages.find((page) => page.id === review.sourcePageId);
if (!source || source.properties?.['useAI?']?.checkbox !== true) throw new Error('The source page is missing or useAI? is not checked.');
const related = pages.filter((page) => richText(page.properties?.['Source submission']?.rich_text) === source.id);
if (related.some((page) => (page.properties?.['Source event number']?.number || 0) > review.events.length)) {
  throw new Error('Existing event rows exceed the reviewed list. Resolve them manually before removing anything.');
}
const counts = { created: 0, updated: 0 };
for (const [index, event] of review.events.entries()) {
  const number = index + 1;
  const properties = eventProperties(event, source.id, number);
  const existing = number === 1 ? source : related.find((page) => page.properties?.['Source event number']?.number === number);
  if (existing) {
    const current = existing.properties || {};
    // Once the owner has published a reviewed row, Notion edits are authoritative.
    if (current.Select?.status?.name === 'Done' && current['Source event number']?.number === number) continue;
    const same = richText(current['Name of the event']?.title) === event.title.trim()
      && current.Type?.multi_select?.[0]?.name === event.type
      && sameDate(current.Date?.date?.start, event.start)
      && sameDate(current.Date?.date?.end, event.end)
      && richText(current['Location ']?.rich_text) === (event.location?.trim() || '')
      && richText(current['Published description']?.rich_text) === event.description.trim()
      && (!Object.hasOwn(event, 'eventUrl') || (current['Any related website']?.url || '') === (event.eventUrl || ''))
      && richText(current['Source submission']?.rich_text) === source.id
      && current['Source event number']?.number === number;
    if (same) continue;
    if (current.Select?.status?.name === 'Done') delete properties.Select;
    await updateNotionPage(existing.id, properties);
    counts.updated += 1;
  } else {
    await createPage({ ...properties, 'useAI?': { checkbox: false } });
    counts.created += 1;
  }
}
console.log(JSON.stringify(counts));
