# UNCG School of Art Eventboard

A public events calendar. People submit events through Tally. The owner can review submissions at `/admin/`, and a scheduled Codex task can also review new submissions. The public site combines Git-published events with events approved in the review dashboard. Pending submissions and private contact addresses are never served by the public calendar.

## Site

The Vite site reads `public/events.json`, shows upcoming events, and filters by category. Its submission buttons open the published [UNCG School of Art event form](https://tally.so/r/dWBvdK).

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
