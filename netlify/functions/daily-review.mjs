import { getStore } from '@netlify/blobs';

export const config = { schedule: '15 11 * * *' };

const required = ['title', 'category', 'date', 'time', 'location', 'description'];
const allowedCategories = new Set(['Exhibition', 'Talk', 'Workshop', 'Other']);
const textInput = (event) => [event.title, event.category, event.date, event.time, event.location, event.description, event.eventUrl].filter(Boolean).join('\n');

async function moderate(event) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const missing = required.filter((key) => !String(event[key] || '').trim());
  if (missing.length) return { status: 'needs_review', reason: `Missing required fields: ${missing.join(', ')}` };
  if (!allowedCategories.has(event.category)) return { status: 'needs_review', reason: 'Event type is not one of the form choices.' };
  const date = new Date(`${event.date}T23:59:59`);
  if (Number.isNaN(date.getTime()) || date < new Date()) return { status: 'rejected', reason: 'Invalid or past event date.' };
  const link = event.eventUrl ? (() => { try { return new URL(event.eventUrl); } catch { return null; } })() : null;
  if (event.eventUrl && (!link || !['http:', 'https:'].includes(link.protocol))) return { status: 'needs_review', reason: 'Event link is invalid.' };

  const input = [{ type: 'text', text: textInput(event) }];
  if (event.posterUrl) {
    const poster = (() => { try { const u = new URL(event.posterUrl); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } })();
    if (!poster) return { status: 'needs_review', reason: 'Poster link is invalid.' };
    input.push({ type: 'image_url', image_url: { url: poster } });
  }
  const response = await fetch('https://api.openai.com/v1/moderations', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'omni-moderation-latest', input }),
  });
  if (!response.ok) throw new Error(`Moderation API returned ${response.status}`);
  const data = await response.json();
  const result = data.results?.[0];
  if (!result) throw new Error('Moderation API returned no result');
  if (result.flagged) return { status: 'rejected', reason: 'Automated safety screening flagged this submission.', categories: result.categories };

  const classification = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You screen public event submissions for a university School of Art calendar. Decide whether the text clearly describes a specific, public-facing event reasonably related to visual art, design, art history, creative practice, or the UNCG School of Art community. If a poster image is supplied, check that it appears to be a relevant event poster and not unrelated or spam material. Do not try to verify whether the event is real or whether the submitter owns the poster. Unclear, promotional, unrelated, or spam-like submissions must not be approved. Return JSON only: {"decision":"approve"|"hold","reason":"short explanation"}.' },
        { role: 'user', content: [
          { type: 'text', text: JSON.stringify({ title: event.title, category: event.category, date: event.date, time: event.time, location: event.location, description: event.description, eventUrl: event.eventUrl }) },
          ...(event.posterUrl ? [{ type: 'image_url', image_url: { url: event.posterUrl } }] : []),
        ] },
      ],
    }),
  });
  if (!classification.ok) throw new Error(`AI screening returned ${classification.status}`);
  const classified = await classification.json();
  let decision;
  try { decision = JSON.parse(classified.choices?.[0]?.message?.content || '{}'); } catch { throw new Error('AI screening returned invalid JSON'); }
  if (decision.decision !== 'approve') return { status: 'needs_review', reason: String(decision.reason || 'AI screening did not approve this submission.').slice(0, 400) };

  // This is a relevance and safety screen, not event fact-checking or a rights check.
  return { status: 'approved', reason: String(decision.reason || 'Required fields passed, safety screen passed, and AI judged the listing relevant.').slice(0, 400) };
}

export default async () => {
  const store = getStore('event-submissions');
  const { blobs } = await store.list();
  for (const blob of blobs) {
    try {
      const event = await store.get(blob.key, { type: 'json' });
      if (!event || event.status !== 'pending') continue;
      const review = await moderate(event);
      event.status = review.status;
      event.review = { ...review, reviewedAt: new Date().toISOString() };
      await store.setJSON(blob.key, event);
    } catch (error) {
      console.error('Daily review failed for a submission:', blob.key, error?.message || 'unknown error');
      // Fail closed: leave it pending so a transient service failure never publishes it.
    }
  }
};
