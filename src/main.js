const grid = document.querySelector('#event-grid');
const filterButtons = [...document.querySelectorAll('.filter-button')];
let allEvents = [];
let activeFilter = 'all';

const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const safeURL = (value) => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
const formatDate = (value) => {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};

function render() {
  const events = allEvents.filter((event) => activeFilter === 'all' || event.category === activeFilter);
  if (!events.length) {
    const message = allEvents.length ? 'Nothing in this category just yet. Try another filter.' : 'No events are listed right now. Check back soon, or share something happening in our community.';
    grid.innerHTML = `<p class="empty-state">${escapeHTML(message)}</p>`;
    return;
  }
  grid.innerHTML = events.map((event, index) => {
    const poster = safeURL(event.posterUrl);
    const link = safeURL(event.eventUrl);
    const date = formatDate(event.date);
    return `<article class="event-card" style="animation-delay:${Math.min(index * 70, 280)}ms">
      <div class="event-poster">${poster ? `<img src="${escapeHTML(poster)}" alt="Poster for ${escapeHTML(event.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : `<div class="poster-fallback" aria-hidden="true" style="--poster:${index % 2 ? '#273eaa' : '#e1392f'}">${escapeHTML((event.category || 'Art').slice(0, 1))}</div>`}</div>
      <div class="card-meta"><span class="card-category">${escapeHTML(event.category || 'Event')}</span><span>${escapeHTML(date)}</span></div>
      <h3>${escapeHTML(event.title)}</h3>
      <p class="event-description">${escapeHTML(event.description || '')}</p>
      <div class="event-details"><span>${escapeHTML(event.time || '')}</span><span class="event-location">${escapeHTML(event.location || '')}</span>${link ? `<a class="event-link" href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer">More information ↗</a>` : ''}</div>
    </article>`;
  }).join('');
}

filterButtons.forEach((button) => button.addEventListener('click', () => {
  activeFilter = button.dataset.filter;
  filterButtons.forEach((item) => { const selected = item === button; item.classList.toggle('is-active', selected); item.setAttribute('aria-pressed', String(selected)); });
  render();
}));

async function start() {
  const formUrl = safeURL(import.meta.env.VITE_TALLY_FORM_URL || '');
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
    const response = await fetch('/events.json', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('Event feed unavailable');
    const body = await response.json();
    const today = new Date().toISOString().slice(0, 10);
    allEvents = Array.isArray(body.events)
      ? body.events.filter((event) => event.date >= today).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
      : [];
  } catch (error) {
    grid.innerHTML = '<p class="empty-state">The calendar could not load right now. Please try again in a little while.</p>';
  }
  grid.setAttribute('aria-busy', 'false');
  render();
}

start();
