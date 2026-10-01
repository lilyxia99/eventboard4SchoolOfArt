import { acceptInvite, getUser, handleAuthCallback, login, logout } from '@netlify/identity';

const ownerEmail = 'l_xia@uncg.edu';
const $ = (selector) => document.querySelector(selector);
const escape = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
let submissions = [];
let status = 'pending';
let inviteToken = '';

function message(text, isError = false) {
  $('#message').textContent = text;
  $('#message').classList.toggle('error', isError);
}

function show(panel) {
  for (const id of ['login-panel', 'invite-panel', 'review-panel']) $(`#${id}`).hidden = id !== panel;
}

async function request(path, options) {
  const response = await fetch(`/.netlify/functions/${path}`, { credentials: 'same-origin', cache: 'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function field(label, name, value, type = 'text') {
  return `<label>${escape(label)}<input name="${name}" type="${type}" value="${escape(value || '')}" /></label>`;
}

function render() {
  $('#pending-count').textContent = `(${submissions.filter((item) => !item.review).length})`;
  for (const tab of document.querySelectorAll('[data-status]')) {
    const selected = tab.dataset.status === status;
    tab.classList.toggle('selected', selected);
    tab.setAttribute('aria-pressed', String(selected));
  }
  const filtered = submissions.filter((item) => (item.review?.decision || 'pending') === status);
  $('#submissions').innerHTML = filtered.length ? filtered.map((item) => {
    const e = item.review?.event || item.event;
    const reviewed = !!item.review;
    return `<article class="submission" data-id="${escape(item.id)}">
      <div class="submission-head"><div><p class="eyebrow">${escape(item.submittedAt ? new Date(item.submittedAt).toLocaleString() : '')} · ${escape(item.review?.decision || 'Pending')}</p><h3>${escape(e.title || 'Untitled submission')}</h3></div><span class="date">${escape(e.date || 'No date')}</span></div>
      <details ${status === 'pending' ? 'open' : ''}><summary>${reviewed ? 'View decision' : 'Review details'}</summary>
        <form class="decision-form">
          <div class="fields">${field('Event title', 'title', e.title)}<label>Type<select name="category">${['Exhibition', 'Talk', 'Workshop', 'Other'].map((type) => `<option value="${type}" ${e.category === type ? 'selected' : ''}>${type}</option>`).join('')}</select></label>${field('Date', 'date', e.date, 'date')}${field('Time', 'time', e.time)}${field('Location', 'location', e.location)}${field('Event link', 'eventUrl', e.eventUrl, 'url')}${field('Poster image URL', 'posterUrl', e.posterUrl, 'url')}</div>
          <label>Description<textarea name="description" rows="5">${escape(e.description || '')}</textarea></label>
          <label>Image description<textarea name="posterAlt" rows="3">${escape(e.posterAlt || '')}</textarea></label>
          <p class="private">Private contact: ${escape(item.contactEmail || 'Not provided')}</p>
          ${reviewed ? `<p>Decision saved ${escape(item.review.reviewedAt || '')}.</p>` : '<div class="actions"><button type="submit" value="approved">Approve and publish</button><button type="submit" value="rejected" class="reject">Reject</button></div>'}
        </form>
      </details>
    </article>`;
  }).join('') : `<p class="empty">No ${status} submissions.</p>`;
}

async function loadQueue() {
  message('Loading submissions…');
  const data = await request('review-queue');
  submissions = data.submissions || [];
  render();
  message('');
}

async function showForCurrentUser() {
  const user = await getUser();
  if (!user) { show('login-panel'); return; }
  if (user.email?.toLowerCase() !== ownerEmail) {
    show('login-panel');
    message('This account does not have review access.', true);
    return;
  }
  $('#signed-in').textContent = user.email;
  show('review-panel');
  await loadQueue();
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  message('Signing in…');
  try { await login(String(data.get('email')), String(data.get('password'))); await showForCurrentUser(); }
  catch (error) { message(error.message, true); }
});

$('#invite-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  message('Creating account…');
  try { await acceptInvite(inviteToken, String(new FormData(event.currentTarget).get('password'))); inviteToken = ''; await showForCurrentUser(); }
  catch (error) { message(error.message, true); }
});

$('#sign-out').addEventListener('click', async () => {
  await logout(); submissions = []; show('login-panel'); message('Signed out.');
});

$('.tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('[data-status]');
  if (tab) { status = tab.dataset.status; render(); }
});

$('#submissions').addEventListener('submit', async (event) => {
  if (!event.target.matches('.decision-form')) return;
  event.preventDefault();
  const form = event.target;
  const article = form.closest('[data-id]');
  const decision = event.submitter?.value;
  if (!['approved', 'rejected'].includes(decision)) return;
  const eventData = Object.fromEntries(new FormData(form));
  form.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  message(`Saving ${decision} decision…`);
  try {
    await request('review-decision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: article.dataset.id, decision, event: eventData }) });
    await loadQueue();
    message(decision === 'approved' ? 'Approved. The event is now on the public calendar.' : 'Submission rejected.');
  } catch (error) {
    form.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    message(error.message, true);
  }
});

try {
  const callback = await handleAuthCallback();
  if (callback?.type === 'invite' && callback.token) {
    inviteToken = callback.token;
    show('invite-panel');
  } else {
    await showForCurrentUser();
  }
} catch (error) {
  show('login-panel');
  message(error.message, true);
}
