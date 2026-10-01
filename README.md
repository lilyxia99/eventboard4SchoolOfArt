# UNCG School of Art Eventboard

A public events calendar. People submit events through Tally. A scheduled Codex task reviews completed Tally submissions and publishes approved listings by updating `public/events.json` in Git. Netlify builds the site when the repository changes. Unreviewed submissions stay in Tally and are never served by this site.

## Site

The Vite site reads `public/events.json`, shows upcoming events, and filters by category. The submission buttons use `VITE_TALLY_FORM_URL`, which must be the public URL of the published event form. Until that variable is set, the buttons remain disabled.

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

Tell submitters that approved event details and poster images will become public. Do not ask for sensitive personal information. Tally keeps submissions until Codex reviews them; no webhook or Netlify Blobs storage is used by this version.

## Daily Codex review

Set `TALLY_API_KEY` as a secret in the Netlify project's environment variables. This is the API key created in Tally account settings. Set `VITE_TALLY_FORM_URL` to the published form URL. The review task needs the form ID shown by `scripts/fetch-tally-submissions.mjs forms` or in the Tally form URL.

The review script requests completed submissions from the [Tally API](https://developers.tally.so/api-reference/endpoint/forms/submissions/list), following every result page. It accepts the API key through `TALLY_API_KEY` at runtime or on standard input; it does not save the key. It skips submission IDs already recorded in the ignored local `.codex-review-state.json` file.

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
