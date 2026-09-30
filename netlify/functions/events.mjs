import { getStore } from '@netlify/blobs';

export default async () => {
  const store = getStore('event-submissions');
  const { blobs } = await store.list();
  const events = [];
  for (const blob of blobs) {
    const event = await store.get(blob.key, { type: 'json' });
    if (event?.status === 'approved' && event.date >= new Date().toISOString().slice(0, 10)) events.push(event);
  }
  events.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  return new Response(JSON.stringify({ events }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60, s-maxage=60', 'x-content-type-options': 'nosniff' } });
};
