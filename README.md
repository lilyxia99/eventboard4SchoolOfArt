# UNCG School of Art Eventboard

A public events calendar. People submit events through the [Notion form](https://leileixia.notion.site/3ed401da165b80cb8216d9afa845ef79?pvs=105). Reviewed rows stay `In progress` until the owner changes them to `Done`. Only `Done` rows appear on the website. Google Calendar synchronization adds event IDs and links later without changing the status. Undated `Done` rows appear on the website without a calendar entry.

## Site

The site shows `Done` Notion events and filters by category. Undated events display “Date to be announced.” Its submission buttons open the Notion form. Both event cards and the month view read Notion directly. The open page checks for changes every 15 seconds and refreshes when brought back into view; a new page load reads current Notion data. Selecting a dated event opens details and an individual `.ics` download. Calendar and Eventboard links appear when available. Every public Notion event has a shareable detail URL of the form `/#event-<Notion page ID>`.

Run locally with Node.js 20 or newer:

```sh
npm install
npm run dev
```

The production site is [uncg-school-of-art-eventboard.netlify.app](https://uncg-school-of-art-eventboard.netlify.app/). Its source is the GitHub `main` branch.

## Legacy Tally form (inactive)

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

This intake has been replaced by Notion. The former Tally review automation now runs the Notion-to-Google sync.

## Private manual review

The review page is at `https://uncg-school-of-art-eventboard.netlify.app/admin/`. It uses Netlify Identity and checks the signed-in email on every private API request. Only `l_xia@uncg.edu` can read the queue or save decisions. The page reads completed submissions directly from Tally through a server-side Netlify Function; the Tally API key never reaches the browser. The key must be set for the **Functions** scope as `TALLY_API_KEY` (the previously used `TALLY_SIGNING_SECRET` name is also accepted for this project's API key).

To activate login, enable Identity in the Netlify project dashboard, set registration to **Invite only**, and invite `l_xia@uncg.edu`. The invitation link opens the site and is forwarded to `/admin/` to set a password. Keep the site itself public. Identity is configured in the dashboard, not by the build.

This is retained for legacy Tally submissions. It does not publish events to the current Notion-backed website or Google Calendar. The private contact address remains in Tally.

## Notion event feed

The public event feed reads the Notion database at `3ed401da-165b-802d-bd2a-dfe1077ac96b` through `/.netlify/functions/notion-events`. It is not cached and includes only rows whose `Select` status is `Done`, including undated rows. Public title, type, date and time, location, poster, related website, and `Published description` are read directly on each refresh. For a previously reviewed multi-event poster, edit `Published description` on each activity row to change its public description; the original `AI description` remains source material. Contact person, contact email, and phone are never returned. `Source submission` and `Source event number` link multiple activities from one poster. Additional rows inherit the source poster in the public feed. `Google Event ID`, `Google Calendar`, and `Eventboard page` provide reciprocal links for each dated event.

For deployment, add `NOTION_API_KEY` to the Netlify site's **Functions** environment scope and share this database with the Notion integration that owns the token. The ignored local `.env` supports local scripts; Netlify does not receive local `.env` values automatically. If the Notion API is unavailable, the page shows a temporary-unavailable message and does not fall back to other event sources. Older entries in `public/events.json` or the manual review queue do not appear in the event cards unless they are also added to Notion with `Select` set to `Done`.

## Google Calendar sync

`sync-notion-calendar` is scheduled every 15 minutes on Netlify's published deploy when its write credential is configured. It reads only `Done` rows. Dated rows with a title are created or updated on calendar `f9986b287c7b91dce74e53673364bfc7247a882a399a55b4a7027a752d5a6299@group.calendar.google.com`. The sync uses a stable Google event ID derived from the Notion page ID to avoid duplicates. After Google confirms the event, it fills `Google Event ID`, `Google Calendar`, and `Eventboard page`; it never changes the owner's status. Undated `Done` rows receive an `Eventboard page` link, but no Google link or ID. Changing status away from `Done` removes only events previously created by this sync and clears their links on its next run. The website month view updates from Notion without waiting for this calendar sync.

The existing `GOOGLE_CALENDAR_API` is an API key for reading the public calendar; it cannot authorize writes. The local Codex automation reviews submissions daily at 8:00 a.m. Eastern Time, then runs `node --env-file=.env scripts/run-notion-calendar-sync.mjs` using the service-account JSON in the ignored local `.env`. It needs this computer and Codex's local scheduler to be running. The service account has event-edit access to this calendar. The Netlify scheduled function skips safely if `GOOGLE_SERVICE_ACCOUNT_JSON` is absent. Do not commit either credential.

## Local Notion sync and legacy review

The form ID is `dWBvdK`. For local Codex reviews, keep `TALLY_API_KEY` in the ignored local `.env` file or save it in macOS Keychain with `bash scripts/store-tally-api-key.sh`. Netlify masks secret values when they are read back, so a key saved only in Netlify cannot be used by the local scheduled task. Never commit `.env`.

The review script requests completed submissions from the [Tally API](https://developers.tally.so/api-reference/endpoint/forms/submissions/list), following every result page. It reads the API key from the process environment, macOS Keychain, or standard input, in that order. It does not save the key in the repository. This workflow is paused and does not affect the Notion event feed.

The active daily Codex task reviews new Notion submissions and stays quiet when no changes occur. For `useAI?` rows it inspects the poster and AI description, checks each distinct activity, and applies reviewed public fields through `scripts/apply-notion-event-review.mjs` using a private temporary JSON file. Reviewed rows stay `In progress` until the owner chooses `Done`. Once published, the owner's Notion edits remain authoritative and are not overwritten by a later AI review. Each dated `Done` activity has its own website details and `.ics` download; its Google Calendar event is linked after synchronization. The former task reviewed Tally submissions and wrote approved public fields to `public/events.json`. That file is no longer the site's source of public events. The project does not call the OpenAI API.

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
