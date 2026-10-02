# UNCG School of Art Eventboard

A public events calendar. People submit events through the [Notion form](https://leileixia.notion.site/3ed401da165b80cb8216d9afa845ef79?pvs=105). The public event cards display only rows in the connected Notion database whose `Select` status is `Done`.

The public event cards also read the connected Notion database when its `Select` status is `Done`. The Notion API key stays in the server-side Netlify Function and is never sent to the browser.

## Site

The site shows Notion events marked `Done` and filters by category. Events with no date remain visible with “Date to be announced.” Its submission buttons open the Notion form. The month view reads the public Google Calendar; selecting an event opens details and offers an individual `.ics` download.

Run locally with Node.js 20 or newer:

```sh
npm install
npm run dev
```

The production site is [uncg-school-of-art-eventboard.netlify.app](https://uncg-school-of-art-eventboard.netlify.app/). Its source is the GitHub `main` branch.

## Tally form

Use these fields on the published form:

| Tally field label | Input |
| --- | --- |
| Event title | Short text, required |
| Event type | Exhibition, Talk, Workshop, or Other; required |
| Event date | Date, required |
| Event time | Short text, required |
| Location | Short text, required |
| Event description | Long text, required |
| Event link | URL, optional |
| Poster | Image upload, optional |
| Image description | Long text, optional when no poster is uploaded |
| Contact email | Email, required; kept private for editorial follow-up |

Tell submitters that approved event details and poster images will become public. Do not ask for sensitive personal information. Tally keeps submissions until Codex reviews them; no webhook or Netlify Blobs storage is used by this version.

## Private manual review

The review page is at `https://uncg-school-of-art-eventboard.netlify.app/admin/`. It uses Netlify Identity and checks the signed-in email on every private API request. Only `l_xia@uncg.edu` can read the queue or save decisions. The page reads completed submissions directly from Tally through a server-side Netlify Function; the Tally API key never reaches the browser. The key must be set for the **Functions** scope as `TALLY_API_KEY` (the previously used `TALLY_SIGNING_SECRET` name is also accepted for this project's API key).

To activate login, enable Identity in the Netlify project dashboard, set registration to **Invite only**, and invite `l_xia@uncg.edu`. The invitation link opens the site and is forwarded to `/admin/` to set a password. Keep the site itself public. Identity is configured in the dashboard, not by the build.

An approval saves only the editable public event fields to a site-wide Netlify Blobs store and makes the event available to the public calendar. Rejections save only the decision and timestamp. The private contact address remains in Tally. A public endpoint returns SHA-256 hashes of reviewed submission IDs so the local Codex task skips entries already handled in the dashboard without exposing their content. A decision cannot be changed from the dashboard after it is saved; contact the project maintainer if a correction is required.

## Notion event feed

The public calendar reads the Notion database at `3ed401da-165b-802d-bd2a-dfe1077ac96b` through `/.netlify/functions/notion-events`. The first link supplied for this integration pointed to a form block inside that database, not to the database itself. The function queries the database's `Event submission` data source and includes only rows whose status column, currently named `Select`, is exactly `Done`. It maps the actual columns for event name, date, type, location, description, website, and poster. Contact person, contact email, and phone are never returned. Rows with a missing date are still included.

For deployment, add `NOTION_API_KEY` to the Netlify site's **Functions** environment scope and share this database with the Notion integration that owns the token. The ignored local `.env` supports local scripts; Netlify does not receive local `.env` values automatically. If the Notion API is unavailable, the page shows a temporary-unavailable message and does not fall back to other event sources. Older entries in `public/events.json` or the manual review queue do not appear in the event cards unless they are also added to Notion with `Select` set to `Done`.

## Google Calendar sync

`sync-notion-calendar` runs every 15 minutes on Netlify's published deploy. It reads `Done` Notion rows, creates or updates dated events on calendar `f9986b287c7b91dce74e53673364bfc7247a882a399a55b4a7027a752d5a6299@group.calendar.google.com`, and removes only events previously created by this sync if their Notion row is no longer `Done`. Undated rows stay in the event cards but cannot be placed in the month view or exported as a dated `.ics` file. The site reads the Google Calendar's public iCal feed through `calendar-events`; Google may take a little time to refresh that public feed after a sync.

To enable writes, create a Google Cloud service account in a project with the Google Calendar API enabled. Share **this calendar** with the service account email using the “Make changes to events” permission. Put the complete service account JSON in a Netlify environment variable named `GOOGLE_SERVICE_ACCOUNT_JSON`, scoped to Functions, and keep it out of the repository. The value is not available in the current local `.env`, so the sync will report a configuration error until it is supplied. Do not use the calendar's public iCal URL as a write credential.

## Daily Codex review

The form ID is `dWBvdK`. For local Codex reviews, keep `TALLY_API_KEY` in the ignored local `.env` file or save it in macOS Keychain with `bash scripts/store-tally-api-key.sh`. Netlify masks secret values when they are read back, so a key saved only in Netlify cannot be used by the local scheduled task. Never commit `.env`.

The review script requests completed submissions from the [Tally API](https://developers.tally.so/api-reference/endpoint/forms/submissions/list), following every result page. It reads the API key from the process environment, macOS Keychain, or standard input, in that order. It does not save the key in the repository. It skips submission IDs already recorded in the ignored local `.codex-review-state.json` file or reviewed in the dashboard. If the remote review-status endpoint is unavailable, the local script pauses publication to avoid overriding a manual decision.

For each new submission, the scheduled Codex task checks required fields, future date, safe links and poster, relevance to visual art or the School of Art, and whether the event appears credible. It should leave doubtful entries unpublished and tell the owner why. For an approved entry, it adds only the public event fields to `public/events.json`, records the submission ID and decision in `.codex-review-state.json`, then commits and pushes the updated public file to `main`. The next Netlify deployment publishes it. The task uses Codex's scheduled run; this project does not call the OpenAI API.

An event entry has this shape:

```json
{
  "title": "Example exhibition",
  "category": "Exhibition",
  "date": "2026-10-15",
  "time": "5:00 p.m.",
  "location": "Gatewood Gallery",
  "description": "Public opening reception.",
  "eventUrl": "https://example.org/event",
  "posterUrl": "https://example.org/poster.jpg"
}
```

Only `eventUrl` and `posterUrl` are optional. Poster URLs must remain publicly accessible for the image to appear on the calendar. Recheck a listing if its event details or poster rights are disputed; the automated review cannot verify ownership or factual accuracy.
