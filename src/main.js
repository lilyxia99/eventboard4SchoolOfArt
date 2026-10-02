const grid = document.querySelector('#event-grid');
const filterButtons = [...document.querySelectorAll('.filter-button')];
let allEvents = [];
let visibleEvents = [];
let activeFilter = 'all';
const eventDialog = document.querySelector('#event-dialog');
const eventDialogContent = document.querySelector('#event-dialog-content');
const imageDialog = document.querySelector('#image-dialog');
const imageDialogStage = document.querySelector('#image-dialog-stage');

const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const safeURL = (value) => { if (typeof value !== 'string' || !value.trim()) return ''; try { const url = new URL(value, window.location.origin); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
const todayInGreensboro = () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
};
const formatDate = (value) => {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};

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
    const date = event.endDate ? `${formatDate(event.date)} – ${formatDate(event.endDate)}` : formatDate(event.date);
    return `<article class="event-card" style="animation-delay:${Math.min(index * 70, 280)}ms">
      <button class="card-open" type="button" data-index="${index}" aria-label="View full details for ${escapeHTML(event.title)}" aria-haspopup="dialog"></button>
      <div class="event-poster${poster ? ' has-image' : ''}">${poster ? `<button class="poster-open" type="button" data-index="${index}" aria-label="Enlarge poster for ${escapeHTML(event.title)}" aria-haspopup="dialog"><img src="${escapeHTML(poster)}" alt="${escapeHTML(event.posterAlt || `Poster for ${event.title}`)}" loading="lazy" referrerpolicy="no-referrer"></button>` : `<div class="poster-fallback" aria-hidden="true" style="--poster:${index % 2 ? '#273eaa' : '#e1392f'}">${escapeHTML((event.category || 'Art').slice(0, 1))}</div>`}</div>
      <div class="card-meta"><span class="card-category">${escapeHTML(event.category || 'Event')}</span><span>${escapeHTML(date)}</span></div>
      <h3>${escapeHTML(event.title)}</h3>
      <p class="event-description">${escapeHTML(event.description || '')}</p>
      <div class="event-details"><span>${escapeHTML(event.time || '')}</span><span class="event-location">${escapeHTML(event.location || '')}</span><span class="card-open-hint">View full details ↗</span></div>
    </article>`;
  }).join('');
}

function relatedLinks(event) {
  const links = [{ label: 'More information', url: event.eventUrl }, ...(Array.isArray(event.links) ? event.links : [])];
  const items = links.map(({ label, url }) => {
    const href = safeURL(url);
    return href ? `<a class="event-dialog-link" href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(label || 'More information')} ↗</a>` : '';
  }).filter(Boolean);
  return items.length ? `<section class="event-dialog-links" aria-label="Related links"><h3>Related links</h3>${items.join('')}</section>` : '';
}

function openEvent(event) {
  if (!event) return;
  const poster = safeURL(event.posterUrl);
  const date = event.endDate ? `${formatDate(event.date)} – ${formatDate(event.endDate)}` : formatDate(event.date);
  eventDialogContent.innerHTML = `<div class="event-dialog-layout${poster ? ' has-poster' : ''}">
    ${poster ? `<button class="event-dialog-poster" type="button" aria-label="Enlarge poster for ${escapeHTML(event.title)}"><img src="${escapeHTML(poster)}" alt="${escapeHTML(event.posterAlt || `Poster for ${event.title}`)}"></button>` : ''}
    <div class="event-dialog-copy"><p class="event-dialog-category">${escapeHTML(event.category || 'Event')} · ${escapeHTML(date)}</p>
      <h2 id="event-dialog-title">${escapeHTML(event.title)}</h2>
      <dl class="event-dialog-facts"><div><dt>When</dt><dd>${escapeHTML(event.time || date)}</dd></div><div><dt>Where</dt><dd>${escapeHTML(event.location || 'See event details')}</dd></div></dl>
      <p class="event-dialog-description">${escapeHTML(event.description || '')}</p>${relatedLinks(event)}
    </div>
  </div>`;
  if (poster) eventDialogContent.querySelector('.event-dialog-poster').addEventListener('click', () => openImage(event));
  eventDialog.showModal();
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

filterButtons.forEach((button) => button.addEventListener('click', () => {
  activeFilter = button.dataset.filter;
  filterButtons.forEach((item) => { const selected = item === button; item.classList.toggle('is-active', selected); item.setAttribute('aria-pressed', String(selected)); });
  render();
}));

async function start() {
  if (window.location.hash.startsWith('#invite_token=')) {
    window.location.replace(`/admin/${window.location.hash}`);
    return;
  }
  const formUrl = safeURL('https://tally.so/r/dWBvdK');
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
  try {
    const response = await fetch('/.netlify/functions/notion-events', { cache: 'no-store', headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('Notion event feed unavailable');
    const body = await response.json();
    const today = todayInGreensboro();
    allEvents = (Array.isArray(body.events) ? body.events : [])
      .filter((event) => (event.endDate || event.date) >= today)
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  } catch (error) {
    grid.innerHTML = '<p class="empty-state">The event list is temporarily unavailable. Please try again in a little while.</p>';
  }
  grid.setAttribute('aria-busy', 'false');
  render();
}

start();
