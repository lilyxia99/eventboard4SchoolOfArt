# UNCG School of Art Eventboard

A public events calendar. People submit events through Tally. A scheduled Codex task reviews completed Tally submissions and publishes approved listings by updating `public/events.json` in Git. Netlify builds the site when the repository changes. Unreviewed submissions stay in Tally and are never served by this site.

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

## Daily Codex review

The form ID is `dWBvdK`. For local Codex reviews, keep `TALLY_API_KEY` in the ignored local `.env` file or save it in macOS Keychain with `bash scripts/store-tally-api-key.sh`. Netlify masks secret values when they are read back, so a key saved only in Netlify cannot be used by the local scheduled task. Never commit `.env`.

The review script requests completed submissions from the [Tally API](https://developers.tally.so/api-reference/endpoint/forms/submissions/list), following every result page. It reads the API key from the process environment, macOS Keychain, or standard input, in that order. It does not save the key in the repository. It skips submission IDs already recorded in the ignored local `.codex-review-state.json` file.

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
