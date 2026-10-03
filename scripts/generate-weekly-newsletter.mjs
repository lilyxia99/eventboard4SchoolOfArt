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
function linkifyText(value) {
  return String(value || '').split(/(https?:\/\/[^\s<>"']+)/gi).map((part) => {
    if (!/^https?:\/\//i.test(part)) return escapeHtml(part);
    const suffix = part.match(/[.,;!?]+$/)?.[0] || '';
    const url = part.slice(0, part.length - suffix.length);
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return escapeHtml(part);
      return `<a href="${escapeHtml(parsed.href)}" style="color:#273eaa;text-decoration:underline">${escapeHtml(url)}</a>${escapeHtml(suffix)}`;
    } catch { return escapeHtml(part); }
  }).join('');
}

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
  const lines = ['UNCG School of Art Eventboard', `Events for ${issue.label} · Times are Eastern`, ''];
  for (const event of issue.events) {
    lines.push(event.title, event.when, event.location || 'Location to be announced', event.description || '', `Event details: ${event.pageUrl}`);
    if (event.eventUrl) lines.push(`Event link: ${event.eventUrl}`);
    if (event.tags.length) lines.push(`Tags: ${event.tags.join(' · ')}`);
    lines.push('');
  }
  lines.push('You are receiving this because you subscribed to the School of Art Eventboard weekly email.', `Unsubscribe: ${SITE}/unsubscribe`, 'Or reply with “unsubscribe” in the subject.', 'Leilei Xia · Gatewood Studio Arts Building · 527 Highland Ave. · Greensboro, NC 27412');
  return lines.join('\n');
}

function renderHtml(issue, email = false) {
  const cards = issue.events.map((event) => `<section style="padding:28px 0;border-top:1px solid #d4d0c7"><h2 style="font:400 34px/1.15 'Jersey 25',sans-serif;color:#c62d27;margin:0 0 14px">${escapeHtml(event.title)}</h2><p style="margin:0 0 14px"><strong><u>${escapeHtml(event.when)}</u></strong><br><strong><u>${escapeHtml(event.location || 'Location to be announced')}</u></strong></p>${event.description ? `<p>${linkifyText(event.description)}</p>` : ''}${event.poster ? `<p><img src="${escapeHtml(email ? event.poster.publicUrl : event.poster.fileName)}" alt="${escapeHtml(event.poster.alt)}" style="display:block;max-width:100%;width:360px;height:auto"></p>` : ''}<p><a href="${escapeHtml(event.pageUrl)}" style="color:#273eaa;text-decoration:underline">View event details</a>${event.eventUrl ? ` · <a href="${escapeHtml(event.eventUrl)}" style="color:#273eaa;text-decoration:underline">Event link</a>` : ''}</p>${event.tags.length ? `<p style="font-style:italic;color:#55564f;text-align:right;margin:16px 0 0">${escapeHtml(event.tags.join(' · '))}</p>` : ''}</section>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><style>@import url('https://fonts.googleapis.com/css2?family=Geist+Pixel&family=Jersey+25&display=swap');</style><title>${escapeHtml(issue.subject)}</title><body style="font:16px/1.55 'Geist Pixel',sans-serif;color:#181916;max-width:640px;margin:24px auto;padding:0 16px"><p><img src="${SITE}/uncg-event-logo.png" alt="UNCG SoA Eventboard logo" width="240" style="display:block;max-width:100%;height:auto"></p><h1 style="font:400 42px/1.1 'Jersey 25',sans-serif;margin:16px 0 8px">UNCG School of Art Eventboard</h1><p style="font-size:18px;margin:0 0 24px">Events for ${escapeHtml(issue.label)} · Times are Eastern</p>${cards}<footer style="border-top:1px solid #d4d0c7;font-size:14px;padding-top:20px"><p>You are receiving this because you subscribed to the School of Art Eventboard weekly email.</p><p><a href="${SITE}/unsubscribe">Unsubscribe</a> or reply with “unsubscribe” in the subject.</p><p>Leilei Xia · Gatewood Studio Arts Building · 527 Highland Ave. · Greensboro, NC 27412</p></footer></body></html>`;
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
const publishAssets = process.argv.includes('--publish-assets');
const publicDirectory = path.resolve('public', 'newsletter', monday);
if (publishAssets) await fs.mkdir(publicDirectory, { recursive: true });
const events = [];
for (const [index, event] of selected.entries()) {
  const poster = await posterFor(event, directory, index);
  if (poster) {
    poster.publicUrl = `${SITE}/newsletter/${monday}/${poster.fileName}`;
    if (publishAssets) await fs.copyFile(poster.path, path.join(publicDirectory, poster.fileName));
  }
  events.push({
    id: event.id,
    title: cleanText(event.title),
    when: when(event),
    location: cleanText(event.location),
    description: cleanText(event.description),
    tags: [...new Set((Array.isArray(event.tags) ? event.tags : []).map(cleanText).filter(Boolean))],
    pageUrl: `${SITE}/#event-${event.id}`,
    eventUrl: safeUrl(event.eventUrl),
    poster,
  });
}
const label = `${new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${monday}T12:00:00Z`))}–${new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${sunday}T12:00:00Z`))}`;
const issue = { weekStart: monday, weekEnd: sunday, label, subject: `School of Art events · ${label}`, events };
await fs.writeFile(path.join(directory, 'issue.json'), `${JSON.stringify(issue, null, 2)}\n`);
await fs.writeFile(path.join(directory, 'issue.txt'), `${renderText(issue)}\n`);
await fs.writeFile(path.join(directory, 'preview.html'), renderHtml(issue));
await fs.writeFile(path.join(directory, 'email.html'), renderHtml(issue, true));
console.log(JSON.stringify({ weekStart: monday, weekEnd: sunday, eventCount: events.length, posterCount: events.filter((event) => event.poster).length, directory }));
