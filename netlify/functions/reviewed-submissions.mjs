import { createHash } from 'node:crypto';
import { json, reviews } from '../lib/review.mjs';

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  try {
    const { blobs } = await reviews().list({ prefix: 'submission/' });
    const hashes = blobs.map(({ key }) => createHash('sha256').update(key.slice('submission/'.length)).digest('hex'));
    return json({ hashes });
  } catch {
    return json({ error: 'Review status unavailable.' }, 503);
  }
};
