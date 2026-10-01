import { json, publicEvent, requireOwner, reviews, sameOrigin } from '../lib/review.mjs';

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!await requireOwner()) return json({ error: 'Unauthorized' }, 401);
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin.' }, 403);
  try {
    const body = await request.json();
    const id = String(body.id || '');
    if (!/^[a-zA-Z0-9_-]{4,100}$/.test(id)) return json({ error: 'Invalid submission ID.' }, 400);
    if (!['approved', 'rejected'].includes(body.decision)) return json({ error: 'Invalid decision.' }, 400);
    const store = reviews();
    const existing = await store.get(`submission/${id}`, { type: 'json', consistency: 'strong' });
    if (existing) return json({ error: 'This submission has already been reviewed. Refresh the page.' }, 409);
    const record = {
      decision: body.decision,
      reviewedAt: new Date().toISOString(),
      ...(body.decision === 'approved' ? { event: publicEvent(body.event || {}) } : {}),
    };
    await store.setJSON(`submission/${id}`, record);
    return json({ review: record });
  } catch (error) {
    return json({ error: error.message || 'Could not save review.' }, 400);
  }
};
