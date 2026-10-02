import ICAL from 'ical.js';

const ICS_URL = 'https://calendar.google.com/calendar/ical/f9986b287c7b91dce74e53673364bfc7247a882a399a55b4a7027a752d5a6299%40group.calendar.google.com/public/basic.ics';
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=300' };

export function parseCalendar(source) {
  const calendar = new ICAL.Component(ICAL.parse(source));
  for (const timezone of calendar.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(timezone);
  const components = calendar.getAllSubcomponents('vevent');
  const exceptions = new Map();
  for (const component of components) {
    if (!component.hasProperty('recurrence-id')) continue;
    const uid = component.getFirstPropertyValue('uid');
    if (!exceptions.has(uid)) exceptions.set(uid, []);
    exceptions.get(uid).push(component);
  }
  const lower = Date.now() - 366 * 86400000;
  const upper = Date.now() + 730 * 86400000;
  const events = [];
  for (const component of components) {
    if (component.hasProperty('recurrence-id')) continue;
    const item = new ICAL.Event(component);
    for (const exception of exceptions.get(item.uid) || []) item.relateException(new ICAL.Event(exception));
    const add = (details) => {
      const start = details.startDate.toJSDate();
      const end = details.endDate.toJSDate();
      if (end.getTime() < lower || start.getTime() > upper) return;
      const actual = details.item;
      events.push({
        id: `${item.uid}:${details.recurrenceId.toString()}`,
        title: actual.summary || 'Untitled event',
        description: actual.description || '',
        location: actual.location || '',
        allDay: details.startDate.isDate,
        start: details.startDate.isDate ? details.startDate.toString().slice(0, 10) : start.toISOString(),
        end: details.endDate.isDate ? details.endDate.toString().slice(0, 10) : end.toISOString(),
      });
    };
    if (!item.isRecurring()) add({ item, recurrenceId: item.startDate, startDate: item.startDate, endDate: item.endDate });
    else {
      const iterator = item.iterator();
      for (let count = 0; count < 2000; count += 1) {
        const occurrence = iterator.next();
        if (!occurrence || occurrence.toJSDate().getTime() > upper) break;
        add(item.getOccurrenceDetails(occurrence));
      }
    }
  }
  return events.sort((a, b) => a.start.localeCompare(b.start));
}

export default async (request) => {
  if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed.' }), { status: 405, headers });
  try {
    const response = await fetch(ICS_URL, { headers: { Accept: 'text/calendar' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Google Calendar feed failed (${response.status}).`);
    const source = await response.text();
    if (source.length > 3_000_000) throw new Error('Google Calendar feed is too large.');
    return new Response(JSON.stringify({ events: parseCalendar(source) }), { headers });
  } catch (error) {
    console.error('Google Calendar feed failed:', error instanceof Error ? error.message : 'Unknown error');
    return new Response(JSON.stringify({ error: 'The calendar is temporarily unavailable.' }), { status: 503, headers });
  }
};
