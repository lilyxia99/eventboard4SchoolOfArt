import { json, reviews } from '../lib/review.mjs';

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  try {
    const store = reviews();
    const { blobs } = await store.list({ prefix: 'submission/' });
    const records = await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json', consistency: 'strong' })));
    const events = records.filter((record) => record?.decision === 'approved' && record.event).map((record) => record.event);
    return json({ events });
  } catch {
    return json({ error: 'Approved events are temporarily unavailable.' }, 503);
  }
};
