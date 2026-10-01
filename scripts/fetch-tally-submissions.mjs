import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const mode = process.argv[2] || 'forms';
const formId = process.argv[3] || process.env.TALLY_FORM_ID;

async function tokenFromInput() {
  if (process.env.TALLY_API_KEY) return process.env.TALLY_API_KEY.trim();
  try {
    return execFileSync('security', ['find-generic-password', '-a', 'eventboard4SchoolOfArt', '-s', 'tally-api-key', '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // A key can also be supplied on standard input in noninteractive runs.
  }
  if (process.stdin.isTTY) throw new Error('Save the Tally API key in macOS Keychain or provide TALLY_API_KEY.');
  return new Promise((resolve, reject) => {
    process.stdin.once('data', (chunk) => resolve(String(chunk).trim()));
    process.stdin.once('error', reject);
    process.stdin.once('end', () => reject(new Error('Save the Tally API key in macOS Keychain or provide TALLY_API_KEY.')));
    process.stdin.resume();
  });
}

function reviewedIds() {
  try {
    const state = JSON.parse(readFileSync('.codex-review-state.json', 'utf8'));
    return new Set(Object.keys(state.reviewed || {}));
  } catch (error) {
    if (error.code === 'ENOENT') return new Set();
    throw error;
  }
}

async function manuallyReviewedHashes() {
  const response = await fetch('https://uncg-school-of-art-eventboard.netlify.app/.netlify/functions/reviewed-submissions');
  if (!response.ok) throw new Error(`Could not check manual review decisions (${response.status}); publication paused.`);
  const result = await response.json();
  if (!Array.isArray(result.hashes)) throw new Error('Manual review response is invalid; publication paused.');
  return new Set(result.hashes);
}

const token = await tokenFromInput();
if (!token) throw new Error('TALLY_API_KEY is empty.');

async function tallyPage(path, page) {
  const url = new URL(`https://api.tally.so${path}`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', '100');
  if (mode === 'submissions') url.searchParams.set('filter', 'completed');
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, 'tally-version': '2025-02-01' },
  });
  if (!response.ok) throw new Error(`Tally API request failed (${response.status}).`);
  return response.json();
}

if (mode === 'forms') {
  const forms = [];
  for (let page = 1; ; page += 1) {
    const result = await tallyPage('/forms', page);
    forms.push(...(result.items || []).map(({ id, name, status, numberOfSubmissions }) => ({ id, name, status, numberOfSubmissions })));
    if (!result.hasMore) break;
  }
  process.stdout.write(`${JSON.stringify({ forms }, null, 2)}\n`);
} else if (mode === 'submissions') {
  if (!formId) throw new Error('A Tally form ID is required.');
  const seen = reviewedIds();
  const manuallyReviewed = await manuallyReviewedHashes();
  const submissions = [];
  for (let page = 1; ; page += 1) {
    const result = await tallyPage(`/forms/${encodeURIComponent(formId)}/submissions`, page);
    const questions = new Map((result.questions || []).map((question) => [question.id, question.title || question.id]));
    for (const submission of result.submissions || []) {
      const digest = createHash('sha256').update(submission.id).digest('hex');
      if (!submission.isCompleted || seen.has(submission.id) || manuallyReviewed.has(digest)) continue;
      submissions.push({
        id: submission.id,
        submittedAt: submission.submittedAt,
        answers: (submission.responses || []).map((response) => ({
          question: questions.get(response.questionId) || response.questionId,
          answer: response.formattedAnswer ?? response.answer,
        })),
      });
    }
    if (!result.hasMore) break;
  }
  process.stdout.write(`${JSON.stringify({ formId, submissions }, null, 2)}\n`);
} else {
  throw new Error('Use forms or submissions as the first argument.');
}
