import { syncCalendar } from '../netlify/functions/sync-notion-calendar.mjs';

try {
  const result = await syncCalendar();
  if (result.created || result.updated || result.removed || result.published) {
    console.log(JSON.stringify(result));
  }
} catch (error) {
  console.error('Notion to Google Calendar sync failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
}
