import fs from 'node:fs/promises';
import path from 'node:path';

const SITE = 'https://uncg-event.com';
const TIME_ZONE = 'America/New_York';
const outputRoot = path.resolve('.codex-newsletter');
const dateParts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'long', month: 'long', day: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' });

function localDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parts = Object.fromEntries(dateParts.formatToParts(new Date(value)).map(({ type, value: text }) => [type, text]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(day, count) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function weekStart() {
  const requested = process.argv.find((arg) => arg.startsWith('--week='))?.slice(7);
  if (requested) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requested) || new Date(`${requested}T12:00:00Z`).getUTCDay() !== 1) {
      throw new Error('--week must be a Monday in YYYY-MM-DD format.');
    }
    return requested;
  }
  const today = localDate(new Date().toISOString());
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  return addDays(today, (8 - weekday) % 7);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

function eventDays(event) {
  const start = event.start || event.date;
  if (!start) return null;
  const first = localDate(start);
  const last = localDate(event.endDate || event.end || start);
  return { first, last };
}

function when(event) {
  const start = event.start || event.date;
  if (!start) return 'Date to be announced';
  const day = dayFormat.format(new Date(start.includes('T') ? start : `${start}T12:00:00Z`));
  if (!start.includes('T')) return `${day} · All day`;
  const end = event.end && event.end.includes('T') ? new Date(event.end) : null;
  const startTime = timeFormat.format(new Date(start));
  const endTime = end && !Number.isNaN(end.getTime()) ? timeFormat.format(end) : '';
  const endDay = end ? localDate(event.end) : '';
  return `${day} · ${startTime}${endTime ? `–${endTime}${endDay !== localDate(start) ? ` (ends ${endDay})` : ''}` : ''} ET`;
}

async function posterFor(event, directory, index) {
  const url = safeUrl(event.posterUrl);
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const mime = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[mime];
    if (!extension) throw new Error('unsupported image type');
    if (Number(response.headers.get('content-length')) > 5_000_000) throw new Error('image exceeds 5 MB');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 5_000_000) throw new Error('image exceeds 5 MB');
    const fileName = `poster-${String(index + 1).padStart(2, '0')}.${extension}`;
    await fs.writeFile(path.join(directory, fileName), bytes);
    return { fileName, path: path.join(directory, fileName), mime, alt: cleanText(event.posterAlt) || `Poster for ${event.title}` };
  } catch (error) {
    throw new Error(`Could not include poster for ${event.id}: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

function renderText(issue) {
  const lines = [`UNCG School of Art Eventboard · ${issue.label}`, 'Unofficial weekly event summary · Times are Eastern', ''];
  for (const event of issue.events) {
    lines.push(event.title, event.when, event.location || 'Location to be announced', event.description || '', `Event details: ${event.pageUrl}`);
    if (event.eventUrl) lines.push(`Event link: ${event.eventUrl}`);
    lines.push('');
  }
  lines.push('You are receiving this because you subscribed to the School of Art Eventboard weekly email.', `Unsubscribe: ${SITE}/unsubscribe`, 'Or reply with “unsubscribe” in the subject.', 'Leilei Xia · Gatewood Studio Arts Building · 527 Highland Ave. · Greensboro, NC 27412');
  return lines.join('\n');
}

function renderHtml(issue) {
  const cards = issue.events.map((event) => `<section style="padding:20px 0;border-top:1px solid #cbd2dd"><h2 style="font-size:22px;margin:0 0 8px">${escapeHtml(event.title)}</h2><p><strong>${escapeHtml(event.when)}</strong><br>${escapeHtml(event.location || 'Location to be announced')}</p><p>${escapeHtml(event.description)}</p>${event.poster ? `<p><img src="${escapeHtml(event.poster.fileName)}" alt="${escapeHtml(event.poster.alt)}" style="display:block;max-width:100%;width:360px;height:auto"></p>` : ''}<p><a href="${escapeHtml(event.pageUrl)}">View event details</a>${event.eventUrl ? ` · <a href="${escapeHtml(event.eventUrl)}">Event link</a>` : ''}</p></section>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(issue.subject)}</title><body style="font:16px/1.55 Arial,sans-serif;color:#181916;max-width:640px;margin:24px auto;padding:0 16px"><p>UNCG School of Art Eventboard · Unofficial weekly event summary</p><h1>Events for ${escapeHtml(issue.label)}</h1><p>Times are Eastern.</p>${cards}<footer style="border-top:1px solid #cbd2dd;font-size:14px;padding-top:20px"><p>You are receiving this because you subscribed to the School of Art Eventboard weekly email.</p><p><a href="${SITE}/unsubscribe">Unsubscribe</a> or reply with “unsubscribe” in the subject.</p><p>Leilei Xia · Gatewood Studio Arts Building · 527 Highland Ave. · Greensboro, NC 27412</p></footer></body></html>`;
}

const monday = weekStart();
const sunday = addDays(monday, 6);
const response = await fetch(`${SITE}/.netlify/functions/notion-events`, { signal: AbortSignal.timeout(15000) });
if (!response.ok) throw new Error(`Published Notion event feed failed (${response.status}).`);
const payload = await response.json();
if (!Array.isArray(payload.events)) throw new Error('Published Notion event feed has an unexpected format.');
const selected = payload.events.filter((event) => {
  const days = eventDays(event);
  return days && days.first <= sunday && days.last >= monday && event.title && event.title !== 'Untitled event';
}).sort((a, b) => (a.start || a.date).localeCompare(b.start || b.date) || a.title.localeCompare(b.title));
const directory = path.join(outputRoot, monday);
await fs.mkdir(directory, { recursive: true });
const events = [];
for (const [index, event] of selected.entries()) {
  events.push({
    id: event.id,
    title: cleanText(event.title),
    when: when(event),
    location: cleanText(event.location),
    description: cleanText(event.description),
    pageUrl: `${SITE}/#event-${event.id}`,
    eventUrl: safeUrl(event.eventUrl),
    poster: await posterFor(event, directory, index),
  });
}
const label = `${new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${monday}T12:00:00Z`))}–${new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${sunday}T12:00:00Z`))}`;
const issue = { weekStart: monday, weekEnd: sunday, label, subject: `School of Art events · ${label}`, events };
await fs.writeFile(path.join(directory, 'issue.json'), `${JSON.stringify(issue, null, 2)}\n`);
await fs.writeFile(path.join(directory, 'issue.txt'), `${renderText(issue)}\n`);
await fs.writeFile(path.join(directory, 'preview.html'), renderHtml(issue));
console.log(JSON.stringify({ weekStart: monday, weekEnd: sunday, eventCount: events.length, posterCount: events.filter((event) => event.poster).length, directory }));
