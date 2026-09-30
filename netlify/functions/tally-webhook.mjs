import { createHmac, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const json = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
const plain = (value) => String(value ?? '').trim();

function verifySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function fieldMap(payload) {
  const fields = payload?.data?.fields;
  if (!Array.isArray(fields)) return {};
  return Object.fromEntries(fields.map((field) => [plain(field.label).toLowerCase(), field.value]));
}

function firstString(value) {
  if (Array.isArray(value)) return firstString(value[0]);
  if (value && typeof value === 'object') return plain(value.url || value.src || value.name);
  return plain(value);
}

export default async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'POST required' });
  const rawBody = await request.text();
  if (rawBody.length > 1_000_000) return json(413, { error: 'Submission too large' });
  if (!verifySignature(rawBody, request.headers.get('tally-signature'), process.env.TALLY_SIGNING_SECRET)) return json(401, { error: 'Invalid signature' });

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return json(400, { error: 'Invalid JSON' }); }
  if (payload?.eventType !== 'FORM_RESPONSE') return json(200, { ok: true, skipped: true });

  const fields = fieldMap(payload);
  const pick = (...labels) => {
    for (const label of labels) if (fields[label] !== undefined && fields[label] !== '') return firstString(fields[label]);
    return '';
  };
  const event = {
    id: plain(payload?.data?.submissionId || payload?.data?.responseId),
    receivedAt: new Date().toISOString(),
    title: pick('event title', 'title', 'name of event'),
    category: pick('event type', 'category', 'type'),
    date: pick('event date', 'date'),
    time: pick('event time', 'time'),
    location: pick('location', 'event location'),
    description: pick('event description', 'description', 'details'),
    eventUrl: pick('event link', 'registration link', 'website'),
    posterUrl: pick('poster', 'event poster', 'upload a poster', 'poster upload'),
    status: 'pending',
    review: null,
  };
  if (!event.id) return json(400, { error: 'Missing Tally submission ID' });
  const store = getStore('event-submissions');
  await store.setJSON(event.id, event);
  return json(200, { ok: true, status: 'pending' });
};
