import { randomUUID } from 'node:crypto';

const token = process.env.TALLY_API_KEY?.trim();
if (!token) throw new Error('TALLY_API_KEY is required. Load it from the ignored local .env file.');

const formName = 'UNCG School of Art — Event Submission';
const headers = {
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
  'tally-version': '2025-02-01',
};

async function tally(path, options = {}) {
  const response = await fetch(`https://api.tally.so${path}`, { ...options, headers });
  const body = await response.json();
  if (!response.ok) throw new Error(`Tally API request failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

function block(type, groupType, payload, groupUuid = randomUUID()) {
  return { uuid: randomUUID(), type, groupUuid, groupType, payload };
}

function question(label, type, payload = {}) {
  return [
    block('TITLE', 'QUESTION', { html: label }),
    block(type, type, payload),
  ];
}

const existing = await tally('/forms?page=1&limit=100');
if ((existing.items || []).some((form) => form.name === formName)) {
  throw new Error(`A form named "${formName}" already exists. Review it before creating another.`);
}

const categoryGroup = randomUUID();
const categories = ['Exhibition', 'Talk', 'Workshop', 'Other'];
const blocks = [
  block('FORM_TITLE', 'TEXT', { title: formName, html: formName }),
  block('TEXT', 'TEXT', { html: 'Share an upcoming visual arts event with the UNCG School of Art community. Submissions are reviewed before they appear on the public event board. Please submit one event per form.' }),
  ...question('Event title', 'INPUT_TEXT', { isRequired: true, placeholder: 'Name of the exhibition, talk, or event' }),
  block('TITLE', 'QUESTION', { html: 'Event type' }),
  ...categories.map((name, index) => block('DROPDOWN_OPTION', 'DROPDOWN', {
    index,
    isFirst: index === 0,
    isLast: index === categories.length - 1,
    isRequired: true,
    text: name,
  }, categoryGroup)),
  ...question('Event date', 'INPUT_DATE', { isRequired: true }),
  ...question('Event time', 'INPUT_TEXT', { isRequired: true, placeholder: 'For example, 5:00–7:00 p.m. ET' }),
  ...question('Location', 'INPUT_TEXT', { isRequired: true, placeholder: 'Venue name and address, or online' }),
  ...question('Event description', 'TEXTAREA', { isRequired: true, placeholder: 'What is happening? Include details visitors should know.' }),
  ...question('Event link (optional)', 'INPUT_LINK', { isRequired: false, placeholder: 'https://...' }),
  ...question('Poster or event image (optional)', 'FILE_UPLOAD', {
    isRequired: false,
    hasMultipleFiles: false,
    allowedFiles: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp'] },
  }),
  ...question('Image description (if uploading an image)', 'TEXTAREA', { isRequired: false, placeholder: 'Describe the important words and visuals for visitors who cannot see the image.' }),
  block('TEXT', 'TEXT', { html: 'Upload an image only if you have permission for it to appear on the public event board. We may edit event text for clarity. Your contact email is used only if we need to ask about the submission; it will not appear on the event board.' }),
  ...question('Contact email (private)', 'INPUT_EMAIL', { isRequired: true, placeholder: 'you@example.com' }),
];

const created = await tally('/forms', {
  method: 'POST',
  body: JSON.stringify({ status: 'PUBLISHED', blocks, settings: { language: 'en' } }),
});
process.stdout.write(`${JSON.stringify({ id: created.id, name: created.name, status: created.status, url: `https://tally.so/r/${created.id}` }, null, 2)}\n`);
