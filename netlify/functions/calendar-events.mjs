const CALENDAR_ID = 'f9986b287c7b91dce74e53673364bfc7247a882a399a55b4a7027a752d5a6299@group.calendar.google.com';
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60, s-maxage=60' };

export default async (request) => {
  if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed.' }), { status: 405, headers });
  const key = globalThis.Netlify?.env?.get('GOOGLE_CALENDAR_API') || process.env.GOOGLE_CALENDAR_API;
  if (!key) return new Response(JSON.stringify({ error: 'The Google Calendar API key is not configured.' }), { status: 503, headers });
  try {
    const lower = new Date(Date.now() - 366 * 86400000).toISOString();
    const upper = new Date(Date.now() + 730 * 86400000).toISOString();
    const events = [];
    let pageToken;
    do {
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`);
      url.searchParams.set('key', key);
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
      url.searchParams.set('timeMin', lower);
      url.searchParams.set('timeMax', upper);
      url.searchParams.set('maxResults', '2500');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`Google Calendar read failed (${response.status}).`);
      const body = await response.json();
      for (const item of body.items || []) {
        if (item.status === 'cancelled' || !item.start || !item.end) continue;
        events.push({
          id: item.id,
          title: item.summary || 'Untitled event',
          description: item.description || '',
          location: item.location || '',
          allDay: Boolean(item.start.date),
          start: item.start.date || item.start.dateTime,
          end: item.end.date || item.end.dateTime,
        });
      }
      pageToken = body.nextPageToken;
    } while (pageToken);
    return new Response(JSON.stringify({ events }), { headers });
  } catch (error) {
    console.error('Google Calendar feed failed:', error instanceof Error ? error.message : 'Unknown error');
    return new Response(JSON.stringify({ error: 'The calendar is temporarily unavailable.' }), { status: 503, headers });
  }
};
