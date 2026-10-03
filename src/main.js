const grid = document.querySelector('#event-grid');
const tagFilters = document.querySelector('#tag-filters');
const highlightFilters = document.querySelector('#highlight-filters');
const calendarTagFilters = document.querySelector('#calendar-tag-filters');
const calendarHighlightFilters = document.querySelector('#calendar-highlight-filters');
const timeFilters = document.querySelector('#time-filters');
const filterSummary = document.querySelector('#filter-summary');
const calendarFilterSummary = document.querySelector('#calendar-filter-summary');
let allEvents = [];
let visibleEvents = [];
const newFilterSelection = () => ({ tags: new Set(), highlights: new Set(), knownTags: new Set(), knownHighlights: new Set() });
const tileSelection = newFilterSelection();
const calendarSelection = newFilterSelection();
let filtersSynced = true;
let availableTags = [];
let availableHighlights = [];
let activeTimeFilter = 'upcoming';
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
const notionColors = new Set(['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']);
const tagColorClass = (color) => notionColors.has(color) ? ` notion-color-${color}` : ' notion-color-default';
const tagMarkup = (event, tag) => `<span class="event-tag${tagColorClass(event.tagColors?.[tag])}">${escapeHTML(tag)}</span>`;
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
const isPastEvent = (event, now) => {
  const start = event.start || event.date;
  if (!start) return false;
  const end = event.end || event.endDate || start;
  if (!String(start).includes('T') || !String(end).includes('T')) {
    const lastDay = String(end).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(lastDay) && lastDay < localDay(now.toISOString());
  }
  const startTime = Date.parse(start);
  const endTime = event.end ? Date.parse(end) : NaN;
  const deadline = Number.isFinite(endTime) ? endTime : Number.isFinite(startTime) ? startTime + 3600000 : NaN;
  return Number.isFinite(deadline) && deadline <= now.getTime();
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
  const filteredEvents = calendarEvents.map((event, index) => ({ event, index }))
    .filter(({ event }) => matchesFilterSelection(event, calendarSelection));
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
    const matches = filteredEvents.filter(({ event }) => {
      const start = localDay(event.start);
      const end = event.allDay ? localDay(event.end) : localDay(new Date(new Date(event.end).getTime() - 1).toISOString());
      return key >= start && key <= (event.allDay ? localDay(new Date(new Date(`${end}T12:00:00Z`).getTime() - 86400000).toISOString()) : end);
    });
    const buttons = matches.map(({ event, index }) => {
      const firstTag = eventTags(event)[0];
      return `<button type="button" class="month-event${tagColorClass(event.tagColors?.[firstTag])}" data-calendar-index="${index}" aria-label="${escapeHTML(event.title)}, ${escapeHTML(eventWhen(event))}"><span class="month-event-time">${escapeHTML(calendarTime(event))}</span> ${escapeHTML(event.title)}</button>`;
    }).join('');
    return `<div class="month-day${day.getMonth() === selectedMonth.getMonth() ? '' : ' is-outside'}${key === localDay(new Date().toISOString()) ? ' is-today' : ''}"><span class="month-day-number">${day.getDate()}</span>${buttons}</div>`;
  }).join('');
  monthCalendar.innerHTML = weekdays + days;
  monthNote.textContent = !calendarEvents.length ? 'No dated events are published yet.'
    : !filteredEvents.length ? 'No events match the calendar filters.' : 'Times shown in Eastern Time.';
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
  const now = new Date();
  const events = allEvents.filter((event) => {
    const past = isPastEvent(event, now);
    const matchesTime = activeTimeFilter === 'all' || (activeTimeFilter === 'past' ? past : !past);
    return matchesTime && matchesFilterSelection(event, tileSelection);
  });
  visibleEvents = events;
  if (!events.length) {
    const message = allEvents.length ? 'No events match these filters. Try another date or tag.' : 'No events are listed right now. Check back soon, or share something happening in our community.';
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
      ${eventTags(event).length ? `<div class="card-tags" aria-label="Event tags">${eventTags(event).map((tag) => tagMarkup(event, tag)).join('')}</div>` : ''}
      ${eventHighlightTags(event).length ? `<div class="card-highlights" aria-label="Highlight tags"><span class="highlight-label">Highlights</span>${eventHighlightTags(event).map((tag) => highlightTagMarkup(event, tag)).join('')}</div>` : ''}
      <p class="event-description">${escapeHTML(event.description || '')}</p>
      <div class="event-details"><span>${escapeHTML(event.time || '')}</span><span class="event-location">${escapeHTML(event.location || '')}</span>${eventLink ? `<a class="card-event-link" href="${escapeHTML(eventLink)}" target="_blank" rel="noopener noreferrer">Event link ↗</a>` : ''}<span class="card-open-hint">View full details ↗</span></div>
    </article>`;
  }).join('');
}

const eventTags = (event) => [...new Set((Array.isArray(event.tags) && event.tags.length ? event.tags : [event.type || event.category]).map((tag) => String(tag || '').trim()).filter(Boolean))];
const eventHighlightTags = (event) => [...new Set((Array.isArray(event.highlightTags) ? event.highlightTags : []).map((tag) => String(tag || '').trim()).filter(Boolean))];
const highlightTagMarkup = (event, tag) => `<span class="event-tag highlight-tag${tagColorClass(event.highlightTagColors?.[tag])}">${escapeHTML(tag)}</span>`;
const matchesSelectedOptions = (eventOptions, selected, available) => !available.length || selected.size === available.length
  || (selected.size > 0 && eventOptions.some((option) => selected.has(option)));
const matchesFilterSelection = (event, selection) => matchesSelectedOptions(eventTags(event), selection.tags, availableTags)
  && matchesSelectedOptions(eventHighlightTags(event), selection.highlights, availableHighlights);

function refreshSelectionOptions(selection, options, kind) {
  const selected = selection[kind];
  const knownKey = kind === 'tags' ? 'knownTags' : 'knownHighlights';
  for (const value of selected) if (!options.includes(value)) selected.delete(value);
  for (const value of options) if (!selection[knownKey].has(value)) selected.add(value);
  selection[knownKey] = new Set(options);
}

function renderFilterChoices(container, options, selected, kind, colors) {
  container.innerHTML = options.map((option) => {
    const color = allEvents.find((event) => event[colors]?.[option])?.[colors]?.[option];
    const active = selected.has(option);
    return `<button type="button" class="filter-button filter-chip${tagColorClass(color)}${active ? ' is-active' : ''}" data-${kind}="${escapeHTML(option)}" aria-pressed="${active}">${escapeHTML(option)}</button>`;
  }).join('');
}

const selectionSummary = (selected, options, label) => !options.length || selected.size === options.length ? `All ${label}`
  : selected.size ? `${selected.size}/${options.length} ${label}` : `No ${label}`;

function renderFilters() {
  availableTags = [...new Set(allEvents.flatMap(eventTags))].sort((a, b) => a.localeCompare(b));
  availableHighlights = [...new Set(allEvents.flatMap(eventHighlightTags))].sort((a, b) => a.localeCompare(b));
  for (const selection of [tileSelection, calendarSelection]) {
    refreshSelectionOptions(selection, availableTags, 'tags');
    refreshSelectionOptions(selection, availableHighlights, 'highlights');
  }
  renderFilterChoices(tagFilters, availableTags, tileSelection.tags, 'tag', 'tagColors');
  renderFilterChoices(highlightFilters, availableHighlights, tileSelection.highlights, 'highlight', 'highlightTagColors');
  renderFilterChoices(calendarTagFilters, availableTags, calendarSelection.tags, 'tag', 'tagColors');
  renderFilterChoices(calendarHighlightFilters, availableHighlights, calendarSelection.highlights, 'highlight', 'highlightTagColors');
  const timeLabel = { upcoming: 'Upcoming', past: 'Past events', all: 'All dates' }[activeTimeFilter];
  const summary = (selection) => `${selectionSummary(selection.tags, availableTags, 'tags')} · ${selectionSummary(selection.highlights, availableHighlights, 'highlights')}`;
  filterSummary.textContent = `${timeLabel} · ${summary(tileSelection)}`;
  calendarFilterSummary.textContent = `${summary(calendarSelection)}${filtersSynced ? ' · Synced' : ''}`;
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
      ${eventTags(event).length ? `<div class="event-dialog-tags" aria-label="Event tags">${eventTags(event).map((tag) => tagMarkup(event, tag)).join('')}</div>` : ''}
      ${eventHighlightTags(event).length ? `<div class="event-dialog-highlights" aria-label="Highlight tags"><span class="highlight-label">Highlights</span>${eventHighlightTags(event).map((tag) => highlightTagMarkup(event, tag)).join('')}</div>` : ''}
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

function changeSelection(surface, kind, action, value) {
  const key = kind === 'tag' ? 'tags' : 'highlights';
  const options = kind === 'tag' ? availableTags : availableHighlights;
  const targets = filtersSynced ? [tileSelection, calendarSelection] : [surface === 'calendar' ? calendarSelection : tileSelection];
  for (const selection of targets) {
    if (action === 'all') selection[key] = new Set(options);
    else if (action === 'none') selection[key].clear();
    else if (selection[key].has(value)) selection[key].delete(value);
    else selection[key].add(value);
  }
  renderFilters();
  render();
  renderMonth();
}

for (const [container, surface, kind] of [
  [tagFilters, 'tiles', 'tag'], [highlightFilters, 'tiles', 'highlight'],
  [calendarTagFilters, 'calendar', 'tag'], [calendarHighlightFilters, 'calendar', 'highlight'],
]) {
  container.addEventListener('click', (click) => {
    const button = click.target.closest(`[data-${kind}]`);
    if (button) changeSelection(surface, kind, 'toggle', button.dataset[kind]);
  });
}
document.querySelectorAll('[data-filter-action]').forEach((button) => button.addEventListener('click', () => {
  changeSelection(button.dataset.filterSurface, button.dataset.filterKind, button.dataset.filterAction);
}));
document.querySelector('#sync-filters').addEventListener('change', (change) => {
  filtersSynced = change.target.checked;
  if (filtersSynced) {
    tileSelection.tags = new Set(calendarSelection.tags);
    tileSelection.highlights = new Set(calendarSelection.highlights);
  }
  renderFilters();
  render();
  renderMonth();
});
timeFilters.addEventListener('click', (click) => {
  const button = click.target.closest('[data-time]');
  if (!button) return;
  activeTimeFilter = button.dataset.time;
  timeFilters.querySelectorAll('[data-time]').forEach((item) => {
    const selected = item === button;
    item.classList.toggle('is-active', selected);
    item.setAttribute('aria-pressed', String(selected));
  });
  renderFilters();
  render();
});

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
      renderFilters();
      render();
      renderMonth();
      if (eventDialog.open && currentEventId) {
        const updated = allEvents.find((event) => event.id === currentEventId);
        if (updated) openEvent(updated);
        else eventDialog.close();
      }
    } else render();
    hasLoadedEvents = true;
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
