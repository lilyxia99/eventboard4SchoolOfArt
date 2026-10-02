const grid = document.querySelector('#event-grid');
const filterButtons = [...document.querySelectorAll('.filter-button')];
let allEvents = [];
let visibleEvents = [];
let activeFilter = 'all';
let calendarEvents = [];
let currentEventId = '';
let lastEventSignature = '';
let hasLoadedEvents = false;
let refreshingEvents = false;
let selectedMonth = new Date();
selectedMonth = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1);
const monthCalendar = document.querySelector('#month-calendar');
const monthTitle = document.querySelector('#month-title');
const monthNote = document.querySelector('#month-note');
const eventDialog = document.querySelector('#event-dialog');
const eventDialogContent = document.querySelector('#event-dialog-content');
const imageDialog = document.querySelector('#image-dialog');
const imageDialogStage = document.querySelector('#image-dialog-stage');

const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const safeURL = (value) => { if (typeof value !== 'string' || !value.trim()) return ''; try { const url = new URL(value, window.location.origin); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
const formatDate = (value) => {
  if (!value) return 'Date to be announced';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? 'Date to be announced' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};
const localDay = (value) => {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const nextDay = (value) => {
  const day = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
};
const toMonthEvent = (event) => {
  const allDay = !event.start.includes('T');
  return {
    ...event,
    allDay,
    end: allDay ? nextDay(event.end || event.start) : event.end || new Date(new Date(event.start).getTime() + 3600000).toISOString(),
  };
};
const stablePosterURL = (value) => {
  try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return value || ''; }
};
const calendarTime = (event) => event.allDay ? 'All day' : new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(event.start));
const eventWhen = (event) => {
  if (!event.start) return event.time || formatDate(event.date);
  if (event.allDay || !event.start.includes('T')) return `${formatDate(localDay(event.start))}${event.endDate ? ` – ${formatDate(event.endDate)}` : ''} · All day`;
  const start = new Date(event.start);
  const end = event.end ? new Date(event.end) : null;
  const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' }).format(start);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(start);
  const endTime = end && !Number.isNaN(end.getTime()) ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(end) : '';
  return `${date} · ${time}${endTime ? `–${endTime}` : ''} ET`;
};

function renderMonth() {
  monthTitle.textContent = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(selectedMonth);
  const first = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay());
  const last = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0);
  const cells = Math.ceil((first.getDay() + last.getDate()) / 7) * 7;
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => `<div class="month-weekday">${day}</div>`).join('');
  const days = Array.from({ length: cells }, (_, offset) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + offset);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const matches = calendarEvents.map((event, index) => ({ event, index })).filter(({ event }) => {
      const start = localDay(event.start);
      const end = event.allDay ? localDay(event.end) : localDay(new Date(new Date(event.end).getTime() - 1).toISOString());
      return key >= start && key <= (event.allDay ? localDay(new Date(new Date(`${end}T12:00:00Z`).getTime() - 86400000).toISOString()) : end);
    });
    const buttons = matches.map(({ event, index }) => `<button type="button" class="month-event" data-calendar-index="${index}" aria-label="${escapeHTML(event.title)}, ${escapeHTML(eventWhen(event))}"><span class="month-event-time">${escapeHTML(calendarTime(event))}</span> ${escapeHTML(event.title)}</button>`).join('');
    return `<div class="month-day${day.getMonth() === selectedMonth.getMonth() ? '' : ' is-outside'}${key === localDay(new Date().toISOString()) ? ' is-today' : ''}"><span class="month-day-number">${day.getDate()}</span>${buttons}</div>`;
  }).join('');
  monthCalendar.innerHTML = weekdays + days;
}

const icsEscape = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const icsDate = (value) => value.replaceAll('-', '');
const icsUTC = (value) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function downloadICS(event) {
  if (!event.start) return;
  const allDay = event.allDay || !event.start.includes('T');
  const start = allDay ? `DTSTART;VALUE=DATE:${icsDate(event.start.slice(0, 10))}` : `DTSTART:${icsUTC(event.start)}`;
  let endValue = event.end;
  if (!endValue && allDay) {
    const date = new Date(`${event.start.slice(0, 10)}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    endValue = date.toISOString().slice(0, 10);
  }
  if (!endValue && !allDay) endValue = new Date(new Date(event.start).getTime() + 3600000).toISOString();
  if (allDay && !event.allDay && event.end) {
    const date = new Date(`${event.end.slice(0, 10)}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    endValue = date.toISOString().slice(0, 10);
  }
  const end = allDay ? `DTEND;VALUE=DATE:${icsDate(endValue.slice(0, 10))}` : `DTEND:${icsUTC(endValue)}`;
  const eventLink = safeURL(event.eventUrl) || safeURL(event.calendarUrl);
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//UNCG School of Art Eventboard//EN', 'BEGIN:VEVENT', `UID:${icsEscape(event.id || crypto.randomUUID())}@eventboard.uncg.edu`, `DTSTAMP:${icsUTC(new Date().toISOString())}`, start, end, `SUMMARY:${icsEscape(event.title)}`, `DESCRIPTION:${icsEscape(event.description)}`, `LOCATION:${icsEscape(event.location)}`, ...(eventLink ? [`URL:${eventLink}`] : []), 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(event.title || 'event').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'event'}.ics`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function render() {
  const events = allEvents.filter((event) => activeFilter === 'all' || event.category === activeFilter);
  visibleEvents = events;
  if (!events.length) {
    const message = allEvents.length ? 'Nothing in this category just yet. Try another filter.' : 'No events are listed right now. Check back soon, or share something happening in our community.';
    grid.innerHTML = `<p class="empty-state">${escapeHTML(message)}</p>`;
    return;
  }
  grid.innerHTML = events.map((event, index) => {
    const poster = safeURL(event.posterUrl);
    const eventLink = safeURL(event.eventUrl);
    const date = event.endDate ? `${formatDate(event.date)} – ${formatDate(event.endDate)}` : formatDate(event.date);
    return `<article class="event-card" style="animation-delay:${Math.min(index * 70, 280)}ms">
      <button class="card-open" type="button" data-index="${index}" aria-label="View full details for ${escapeHTML(event.title)}" aria-haspopup="dialog"></button>
      ${poster ? `<div class="event-poster has-image"><button class="poster-open" type="button" data-index="${index}" aria-label="Enlarge poster for ${escapeHTML(event.title)}" aria-haspopup="dialog"><img src="${escapeHTML(poster)}" alt="${escapeHTML(event.posterAlt || `Poster for ${event.title}`)}" loading="lazy" referrerpolicy="no-referrer"></button></div>` : ''}
      <div class="card-meta"><span class="card-category">${escapeHTML(event.type || event.category || 'Event')}</span><span>${escapeHTML(date)}</span></div>
      <h3>${escapeHTML(event.title)}</h3>
      <p class="event-description">${escapeHTML(event.description || '')}</p>
      <div class="event-details"><span>${escapeHTML(event.time || '')}</span><span class="event-location">${escapeHTML(event.location || '')}</span>${eventLink ? `<a class="card-event-link" href="${escapeHTML(eventLink)}" target="_blank" rel="noopener noreferrer">Event link ↗</a>` : ''}<span class="card-open-hint">View full details ↗</span></div>
    </article>`;
  }).join('');
}

function relatedLinks(event) {
  const links = [{ label: 'More information', url: event.eventUrl }, { label: 'Open in Google Calendar', url: event.calendarUrl }, ...(Array.isArray(event.links) ? event.links : [])];
  const items = links.map(({ label, url }) => {
    const href = safeURL(url);
    return href ? `<a class="event-dialog-link" href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(label || 'More information')} ↗</a>` : '';
  }).filter(Boolean);
  return items.length ? `<section class="event-dialog-links" aria-label="Related links"><h3>Related links</h3>${items.join('')}</section>` : '';
}

function openEvent(event) {
  if (!event) return;
  currentEventId = event.id || '';
  const poster = safeURL(event.posterUrl);
  const date = eventWhen(event);
  eventDialogContent.innerHTML = `<div class="event-dialog-layout${poster ? ' has-poster' : ''}">
    ${poster ? `<button class="event-dialog-poster" type="button" aria-label="Enlarge poster for ${escapeHTML(event.title)}"><img src="${escapeHTML(poster)}" alt="${escapeHTML(event.posterAlt || `Poster for ${event.title}`)}"></button>` : ''}
    <div class="event-dialog-copy"><p class="event-dialog-category">${escapeHTML(event.type || event.category || 'Event')} · ${escapeHTML(date)}</p>
      <h2 id="event-dialog-title">${escapeHTML(event.title)}</h2>
      <dl class="event-dialog-facts"><div><dt>When</dt><dd>${escapeHTML(date)}</dd></div><div><dt>Where</dt><dd>${escapeHTML(event.location || 'See event details')}</dd></div></dl>
      <p class="event-dialog-description">${escapeHTML(event.description || '')}</p>${relatedLinks(event)}
      <button class="download-ics" type="button" ${event.start ? '' : 'disabled title="Add a date in Notion to enable download"'}>Download .ics</button>
    </div>
  </div>`;
  if (poster) eventDialogContent.querySelector('.event-dialog-poster').addEventListener('click', () => openImage(event));
  eventDialogContent.querySelector('.download-ics').addEventListener('click', () => downloadICS(event));
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(event.id || '')) history.replaceState(null, '', `#event-${event.id}`);
  if (!eventDialog.open) eventDialog.showModal();
}

function openImage(event) {
  const poster = safeURL(event?.posterUrl);
  if (!poster) return;
  const image = document.createElement('img');
  image.src = poster;
  image.alt = event.posterAlt || `Poster for ${event.title}`;
  imageDialogStage.replaceChildren(image);
  imageDialog.showModal();
}

grid.addEventListener('click', (click) => {
  const posterButton = click.target.closest('.poster-open');
  if (posterButton) return openImage(visibleEvents[Number(posterButton.dataset.index)]);
  const cardButton = click.target.closest('.card-open');
  if (cardButton) openEvent(visibleEvents[Number(cardButton.dataset.index)]);
});

for (const dialog of [eventDialog, imageDialog]) {
  dialog.addEventListener('click', (click) => { if (click.target === dialog || (dialog === imageDialog && click.target === imageDialogStage)) dialog.close(); });
  dialog.querySelector('[data-close-dialog]').addEventListener('click', () => dialog.close());
}
imageDialog.addEventListener('close', () => imageDialogStage.replaceChildren());
eventDialog.addEventListener('close', () => {
  currentEventId = '';
  if (location.hash.startsWith('#event-')) history.replaceState(null, '', location.pathname + location.search);
});
monthCalendar.addEventListener('click', (click) => {
  const button = click.target.closest('[data-calendar-index]');
  if (button) openEvent(calendarEvents[Number(button.dataset.calendarIndex)]);
});
document.querySelector('#month-prev').addEventListener('click', () => { selectedMonth.setMonth(selectedMonth.getMonth() - 1); renderMonth(); });
document.querySelector('#month-next').addEventListener('click', () => { selectedMonth.setMonth(selectedMonth.getMonth() + 1); renderMonth(); });
document.querySelector('#month-today').addEventListener('click', () => { selectedMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); renderMonth(); });

filterButtons.forEach((button) => button.addEventListener('click', () => {
  activeFilter = button.dataset.filter;
  filterButtons.forEach((item) => { const selected = item === button; item.classList.toggle('is-active', selected); item.setAttribute('aria-pressed', String(selected)); });
  render();
}));

async function refreshEvents() {
  if (refreshingEvents) return;
  refreshingEvents = true;
  try {
    const response = await fetch(`/.netlify/functions/notion-events?refresh=${Date.now()}`, { cache: 'no-store', headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('Notion event feed unavailable');
    const body = await response.json();
    const events = (Array.isArray(body.events) ? body.events : [])
      .sort((a, b) => `${a.date || '9999-12-31'} ${a.time || ''}`.localeCompare(`${b.date || '9999-12-31'} ${b.time || ''}`));
    const signature = JSON.stringify(events.map((event) => ({ ...event, posterUrl: stablePosterURL(event.posterUrl) })));
    if (!hasLoadedEvents || signature !== lastEventSignature) {
      allEvents = events;
      calendarEvents = events.filter((event) => event.start).map(toMonthEvent);
      lastEventSignature = signature;
      render();
      renderMonth();
      if (eventDialog.open && currentEventId) {
        const updated = allEvents.find((event) => event.id === currentEventId);
        if (updated) openEvent(updated);
        else eventDialog.close();
      }
    }
    hasLoadedEvents = true;
    monthNote.textContent = calendarEvents.length ? 'Times shown in Eastern Time.' : 'No dated events are published yet.';
  } catch {
    if (!hasLoadedEvents) grid.innerHTML = '<p class="empty-state">The event list is temporarily unavailable. Please try again in a little while.</p>';
    monthNote.textContent = hasLoadedEvents ? 'Updates are temporarily unavailable; showing the last loaded events.' : 'The event list is temporarily unavailable.';
  } finally {
    grid.setAttribute('aria-busy', 'false');
    monthCalendar.setAttribute('aria-busy', 'false');
    refreshingEvents = false;
  }
}

async function start() {
  if (window.location.hash.startsWith('#invite_token=')) {
    window.location.replace(`/admin/${window.location.hash}`);
    return;
  }
  const formUrl = safeURL('https://leileixia.notion.site/3ed401da165b80cb8216d9afa845ef79?pvs=105');
  if (formUrl) {
    document.querySelector('#submit-link').href = formUrl;
    document.querySelector('#footer-submit-link').href = formUrl;
    document.querySelectorAll('#submit-link,#footer-submit-link').forEach((link) => { link.target = '_blank'; link.rel = 'noopener noreferrer'; });
  } else {
    document.querySelectorAll('#submit-link,#footer-submit-link').forEach((link) => {
      link.setAttribute('aria-disabled', 'true');
      link.title = 'The submission form will be connected before launch.';
      link.addEventListener('click', (event) => event.preventDefault());
    });
  }
  renderMonth();
  await refreshEvents();
  const linkedId = location.hash.match(/^#event-([0-9a-f-]{36})$/i)?.[1];
  if (linkedId) openEvent(allEvents.find((event) => event.id === linkedId));
  setInterval(() => { if (!document.hidden) refreshEvents(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshEvents(); });
}

start();
