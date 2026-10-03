import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createNotionEvent, getSyncNotionPages, uploadNotionPoster } from '../netlify/functions/notion-events.mjs';

const HIGHLIGHTS = new Set(['snacks', 'Free', 'Ticketed', 'RSVP', 'accessibility']);
const TYPE_OPTIONS = new Set([
  'Exhibition', 'Workshop', 'Screening', 'Lecture', 'Visiting Artist', 'Club', 'Application', 'Course',
  'Class showcase', 'School of Art', 'School of Music', 'School of Dance', 'School of Theatre', 'Painting',
  'Printmaking', 'Photography', 'Sculpture', 'New Media and Design', 'Animation', 'Art History',
  'Art Education', 'Art Administration', 'Greensboro Project Space', 'Other',
]);
const richText = (items) => (items || []).map((item) => item.plain_text || item.text?.content || '').join('').trim();
const text = (value) => ({ rich_text: value ? [{ text: { content: value } }] : [] });
const normalize = (value) => String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const eventDate = (page) => page.properties?.Date?.date?.start?.slice(0, 10) || '';

function validateEvent(event) {
  if (!event || typeof event !== 'object') throw new Error('Each imported activity must be an object.');
  if (typeof event.title !== 'string' || !event.title.trim() || event.title.length > 1900) throw new Error('Invalid event title.');
  if (!TYPE_OPTIONS.has(event.type)) throw new Error('Unsupported event type.');
  if (event.tags !== undefined && (!Array.isArray(event.tags) || event.tags.some((tag) => !TYPE_OPTIONS.has(tag)))) throw new Error('Unsupported event tag.');
  if (typeof event.description !== 'string' || event.description.length > 1900) throw new Error('Invalid event description.');
  if (typeof event.start !== 'string' || !event.start || Number.isNaN(Date.parse(event.start))) throw new Error('A verified event date is required.');
  if (event.end && (Number.isNaN(Date.parse(event.end)) || Date.parse(event.end) <= Date.parse(event.start))) throw new Error('Invalid event end date.');
  if (typeof event.location !== 'string' || event.location.length > 1900) throw new Error('Invalid location.');
  if (event.eventUrl) {
    let url;
    try { url = new URL(event.eventUrl); } catch { throw new Error('Invalid event URL.'); }
    if (url.protocol !== 'https:') throw new Error('Event links must use HTTPS.');
  }
  if (!Array.isArray(event.highlightTags || []) || (event.highlightTags || []).some((tag) => !HIGHLIGHTS.has(tag))) throw new Error('Unsupported highlight tag.');
}

function richTextHas(page, property, expected) {
  return richText(page.properties?.[property]?.rich_text) === expected;
}

async function posterFile(event) {
  if (!event.posterPath) return null;
  const resolved = await realpath(event.posterPath);
  const tempRoot = await realpath(tmpdir());
  const privateTmp = await realpath('/private/tmp').catch(() => '/private/tmp');
  if (!resolved.startsWith(`${tempRoot}${path.sep}`) && !resolved.startsWith(`${privateTmp}${path.sep}`)) {
    throw new Error('Poster must be in a private temporary directory.');
  }
  const bytes = await readFile(resolved);
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('Poster must be smaller than 5 MB.');
  const filename = path.basename(resolved);
  const extension = path.extname(filename).toLowerCase();
  const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' })[extension];
  if (!mime) throw new Error('Poster must be a PNG, JPEG, GIF, or WebP image.');
  return uploadNotionPoster(bytes, filename, mime);
}

const inputPath = process.argv[2];
if (!inputPath) throw new Error('Pass a private JSON file with verified public event fields.');
const input = JSON.parse(await readFile(inputPath, 'utf8'));
if (typeof input.sourceSubmission !== 'string' || !/^(?:outlook|vpa):[^\s]{1,500}$/i.test(input.sourceSubmission)) throw new Error('Source must be an Outlook message or VPA event URL identifier.');
if (!Array.isArray(input.events) || !input.events.length || input.events.length > 30) throw new Error('Expected 1 to 30 activities.');
input.events.forEach(validateEvent);

const pages = await getSyncNotionPages();
const related = pages.filter((page) => richTextHas(page, 'Source submission', input.sourceSubmission));
const counts = { created: 0, duplicate: 0 };

for (const [index, event] of input.events.entries()) {
  const number = index + 1;
  const linked = related.find((page) => page.properties?.['Source event number']?.number === number);
  if (linked) { counts.duplicate += 1; continue; }

  const titleKey = normalize(event.title);
  const dateKey = event.start.slice(0, 10);
  const duplicate = pages.some((page) => {
    const sameDate = eventDate(page) === dateKey;
    const sameTitle = normalize(richText(page.properties?.['Name of the event']?.title)) === titleKey;
    const sameUrl = event.eventUrl && page.properties?.['Any related website']?.url === event.eventUrl;
    return sameDate && (sameTitle || sameUrl);
  });
  if (duplicate) { counts.duplicate += 1; continue; }

  const poster = await posterFile(event);
  const properties = {
    'Name of the event': { title: [{ text: { content: event.title.trim() } }] },
    Select: { status: { name: 'Done' } },
    Type: { multi_select: [...new Set([event.type, ...(event.tags || [])])].map((name) => ({ name })) },
    Highlights: { multi_select: [...new Set(event.highlightTags || [])].map((name) => ({ name })) },
    Date: { date: { start: event.start, ...(event.end ? { end: event.end } : {}) } },
    'Location ': text(event.location.trim()),
    'Published description': text(event.description.trim()),
    'Any related website': { url: event.eventUrl || null },
    'Source submission': text(input.sourceSubmission),
    'Source event number': { number },
    'useAI?': { checkbox: false },
    ...(poster ? { 'Poster (highly recommend)': { files: [poster] } } : {}),
  };
  const saved = await createNotionEvent(properties);
  pages.push(saved);
  related.push(saved);
  counts.created += 1;
}

console.log(JSON.stringify(counts));
