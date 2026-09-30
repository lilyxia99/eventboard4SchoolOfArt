# UNCG School of Art Eventboard

A public-facing events calendar with an open Tally intake form and a daily, fail-closed moderation pass. Submitted events remain private until the moderation job approves them. Approved events are served by a Netlify Function; student visitors do not need to sign in.

## Current state

- Editorial-style, responsive public calendar with category filters and an accessible empty state.
- Tally webhook receiver verifies Tally's `Tally-Signature` before accepting a submission.
- Submissions are stored privately in Netlify Blobs with `pending` status.
- Daily moderation checks required fields, category, future date, URL format, text/poster safety, and topical relevance. OpenAI's moderation endpoint checks safety; an AI classifier screens for relevant, specific art events. Only submissions that pass every automatic check are published.
- The public events endpoint returns approved, upcoming records only.
- Failures leave submissions pending. They are never published on an API error.

This is a starter implementation, not yet connected to a live Tally form or deployed Netlify site. Automated screening cannot verify that an event is real or that the submitter has publication rights for a poster. Set an operational process to inspect the rejected/pending queue and remove a published listing when needed before opening the intake broadly.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and configure the variables listed below.
4. Run `npm run dev` and open the local URL printed by Netlify CLI.

The live Tally webhook and Netlify Blobs storage require a deployed Netlify site. Local webhook testing requires the Netlify CLI and a local Blobs connection.

## Tally form fields

Create and publish a public Tally form. Use these labels so the receiver can map fields:

| Tally field label | Suggested input |
| --- | --- |
| Event title | Short text, required |
| Event type | Dropdown: Exhibition, Talk, Workshop, Other; required |
| Event date | Date, required; use ISO date output |
| Event time | Short text, required |
| Location | Short text, required |
| Event description | Long text, required |
| Event link | URL, optional |
| Poster | File upload, optional; image files only |

Add a short notice that submissions are screened automatically and approved events and poster images become publicly visible. Do not collect sensitive personal information. Tally file uploads are open to anyone who has the form link; this implementation deliberately does not claim to verify submitter identity.

In Tally, open **Integrations → Webhooks**, set the endpoint to `https://YOUR-SITE.netlify.app/api/tally-webhook`, enable a signing secret, and copy that secret into Netlify's environment variables as `TALLY_SIGNING_SECRET`. The function verifies the signed body before saving it.

## Netlify configuration

Deploy this folder as a new Netlify site. Add these site environment variables:

- `TALLY_SIGNING_SECRET`: the secret configured for the Tally webhook.
- `OPENAI_API_KEY`: a server-side OpenAI API key for moderation and classification. Never add it to a `VITE_` variable or frontend file.
- `VITE_TALLY_FORM_URL`: the public URL of the Tally form; Vite uses this for the submit buttons.

Netlify Blobs is the private event store. `daily-review` runs at 11:15 UTC daily (7:15 a.m. Eastern during daylight time, 6:15 a.m. during standard time). Update the cron expression in `netlify/functions/daily-review.mjs` if another time is preferred. The moderation API screens potentially harmful text and images; the classifier checks relevance; code performs completeness/date checks. There is no automatic factual verification or poster-rights check. The classifier has an API usage cost; review current account pricing and set a spending limit before enabling public submissions.

## Status behavior

- `pending`: not public; waiting for the scheduled review or an API retry on the next run.
- `approved`: public while the event date is current or upcoming.
- `rejected`: held out of the public feed after a safety flag or invalid/past date.
- `needs_review`: held out of the public feed when required data or URL/category validation fails.

The initial version has no owner dashboard. Review records using Netlify's Blobs tooling or add an authenticated review screen before using the queue as a production moderation workflow. Do not expose the internal submissions store through a public endpoint.

## Data and publication notes

The event feed exposes approved event text, event links, date/time/location, and poster URLs to anyone. Tally poster links need to remain anonymously accessible for the image cards to load. If Tally changes or expires these links, move approved image files to a public asset store before publishing them. Avoid sending private, confidential, or sensitive material to the moderation service.
