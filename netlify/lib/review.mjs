import { getUser } from '@netlify/identity';
import { getStore } from '@netlify/blobs';

const STORE = 'event-reviews';
const FORM_ID = 'dWBvdK';
const OWNER_EMAIL = 'l_xia@uncg.edu';
const noStore = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' };

export const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: noStore });
export const reviews = () => getStore(STORE);

export async function requireOwner() {
  try {
    const user = await getUser();
    return user?.email?.toLowerCase() === OWNER_EMAIL ? user : null;
  } catch {
    return null;
  }
}

export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return origin === new URL(request.url).origin && request.headers.get('content-type')?.startsWith('application/json');
}

export function safeHttps(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export function publicEvent(input) {
  const event = {
    title: String(input.title || '').trim().slice(0, 180),
    category: ['Exhibition', 'Talk', 'Workshop', 'Other'].includes(input.category) ? input.category : 'Other',
    date: String(input.date || '').trim(),
    time: String(input.time || '').trim().slice(0, 180),
    location: String(input.location || '').trim().slice(0, 300),
    description: String(input.description || '').trim().slice(0, 3000),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date) || Number.isNaN(Date.parse(`${event.date}T12:00:00Z`))) throw new Error('A valid event date is required.');
  for (const field of ['title', 'time', 'location', 'description']) if (!event[field]) throw new Error(`${field} is required.`);
  const eventUrl = safeHttps(input.eventUrl);
  const posterUrl = safeHttps(input.posterUrl);
  if (input.eventUrl && !eventUrl) throw new Error('Event link must be an HTTPS URL.');
  if (input.posterUrl && !posterUrl) throw new Error('Poster link must be an HTTPS URL.');
  if (eventUrl) event.eventUrl = eventUrl;
  if (posterUrl) {
    event.posterUrl = posterUrl;
    event.posterAlt = String(input.posterAlt || '').trim().slice(0, 800);
    if (!event.posterAlt) throw new Error('Image description is required for a poster.');
  }
  return event;
}

function answerText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(answerText).filter(Boolean).join(', ');
  if (value && typeof value === 'object') return String(value.url || value.name || value.label || value.text || '');
  return value == null ? '' : String(value);
}

export function parseSubmission(submission, questions) {
  const answers = {};
  for (const response of submission.responses || []) {
    const question = questions.get(response.questionId) || response.questionId;
    answers[question] = answerText(response.formattedAnswer ?? response.answer).trim();
  }
  return {
    id: submission.id,
    submittedAt: submission.submittedAt,
    contactEmail: answers['Contact email (private)'] || '',
    event: {
      title: answers['Event title'] || '',
      category: answers['Event type'] || 'Other',
      date: answers['Event date'] || '',
      time: answers['Event time'] || '',
      location: answers.Location || '',
      description: answers['Event description'] || '',
      eventUrl: answers['Event link (optional)'] || '',
      posterUrl: answers['Poster or event image (optional)'] || '',
      posterAlt: answers['Image description (if uploading an image)'] || '',
    },
    answers,
  };
}

export async function tallySubmissions() {
  const token = Netlify.env.get('TALLY_API_KEY') || Netlify.env.get('TALLY_SIGNING_SECRET');
  if (!token) throw new Error('Tally API key is not configured for Functions.');
  const submissions = [];
  for (let page = 1; page <= 20; page += 1) {
    const url = new URL(`https://api.tally.so/forms/${FORM_ID}/submissions`);
    url.searchParams.set('filter', 'completed');
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', '100');
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'tally-version': '2025-02-01' } });
    if (!response.ok) throw new Error(`Tally request failed (${response.status}).`);
    const body = await response.json();
    const questions = new Map((body.questions || []).map((question) => [question.id, question.title || question.id]));
    submissions.push(...(body.submissions || []).filter((entry) => entry.isCompleted).map((entry) => parseSubmission(entry, questions)));
    if (!body.hasMore) break;
  }
  return submissions;
}
