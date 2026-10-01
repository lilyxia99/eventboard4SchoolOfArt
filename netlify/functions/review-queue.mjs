import { json, requireOwner, reviews, tallySubmissions } from '../lib/review.mjs';

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  if (!await requireOwner()) return json({ error: 'Please sign in with the authorized reviewer account.' }, 401);
  try {
    const store = reviews();
    const submissions = await tallySubmissions();
    const items = await Promise.all(submissions.map(async (submission) => ({
      ...submission,
      review: await store.get(`submission/${submission.id}`, { type: 'json', consistency: 'strong' }),
    })));
    return json({ submissions: items.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt))) });
  } catch (error) {
    return json({ error: error.message || 'Unable to load submissions.' }, 502);
  }
};
