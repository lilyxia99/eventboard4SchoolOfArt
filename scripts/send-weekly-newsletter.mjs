import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const option = (name) => process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const week = option('--week');
const recipientsPath = option('--recipients');
const send = args.has('--send');
const test = args.has('--test');
const prepare = args.has('--prepare');
const recordSent = args.has('--record-sent');
if (send) throw new Error('Rich newsletter email must be sent from the generated email.html through Mail; plain-text --send is disabled.');
if (prepare && recordSent) throw new Error('Choose --prepare or --record-sent.');
if (!/^\d{4}-\d{2}-\d{2}$/.test(week || '') || !recipientsPath) {
  throw new Error('Usage: node scripts/send-weekly-newsletter.mjs --week=YYYY-MM-DD --recipients=/private/path [--send] [--test]');
}

const directory = path.resolve('.codex-newsletter', week);
const issue = JSON.parse(await fs.readFile(path.join(directory, 'issue.json'), 'utf8'));
if (issue.weekStart !== week || !Array.isArray(issue.events) || issue.events.length === 0) {
  throw new Error('No generated events for this week.');
}
const bodyPath = path.join(directory, 'issue.txt');
const body = await fs.readFile(bodyPath, 'utf8');
if (!body.includes('https://uncg-event.com/unsubscribe')) throw new Error('Unsubscribe link missing.');
const html = await fs.readFile(path.join(directory, 'email.html'), 'utf8');
if (!html.includes('UNCG School of Art Eventboard') || !html.includes('uncg-event-logo.png') || !html.includes('https://uncg-event.com/unsubscribe')) {
  throw new Error('Rich newsletter layout is incomplete.');
}
const recipients = [...new Set((await fs.readFile(recipientsPath, 'utf8')).split(/\r?\n/).map((line) => line.trim().toLowerCase()).filter(Boolean))];
if (!recipients.length || recipients.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
  throw new Error('Recipient list is empty or invalid.');
}
if (test && recipients.length !== 1) throw new Error('A test send requires exactly one subscriber.');
for (const event of issue.events) {
  if (event.poster) {
    const posterPath = path.resolve(event.poster.path);
    if (!posterPath.startsWith(`${directory}${path.sep}`)) throw new Error('Poster path escapes issue directory.');
    await fs.access(posterPath);
  }
}

const statePath = path.resolve('.codex-newsletter-state.json');
const state = JSON.parse(await fs.readFile(statePath, 'utf8').catch((error) => {
  if (error.code === 'ENOENT') return '{}';
  throw error;
}));
const key = `${week}:${test ? 'test' : 'weekly'}`;
const digest = crypto.createHash('sha256').update(JSON.stringify({ issue, recipients })).digest('hex');
if (prepare && state[key]) throw new Error(`This ${test ? 'test' : 'weekly'} issue is already recorded as ${state[key].status}; inspect Mail before retrying.`);
if (recordSent) {
  if (state[key]?.status !== 'pending' || state[key]?.digest !== digest) throw new Error('No matching pending issue; inspect Mail before recording a send.');
  state[key] = { status: 'sent', digest, sentAt: new Date().toISOString(), count: recipients.length };
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ week, mode: 'recorded-sent', test, recipientCount: recipients.length }));
  process.exit(0);
}

function applescriptString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '" & linefeed & "')}"`;
}
const subject = `${test ? '[TEST] ' : ''}${issue.subject}`;
const bccCommands = recipients.map((email) => `  make new bcc recipient at end of bcc recipients of messageRef with properties {address:${applescriptString(email)}}`).join('\n');
const script = `tell application "Mail"
  set messageRef to make new outgoing message with properties {subject:${applescriptString(subject)}, content:"Paste generated email.html here", visible:true}
  set sender of messageRef to "l_xia@uncg.edu"
  make new to recipient at end of to recipients of messageRef with properties {address:"l_xia@uncg.edu"}
${bccCommands}
  save messageRef
end tell`;

if (prepare) {
  state[key] = { status: 'pending', digest, startedAt: new Date().toISOString() };
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}
const child = spawn('osascript', ['-'], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.end(script);
let stderr = '';
for await (const chunk of child.stderr) stderr += chunk;
for await (const chunk of child.stdout) { /* Mail object IDs and recipients are never logged. */ }
const code = await new Promise((resolve) => child.on('close', resolve));
if (code !== 0) throw new Error(`Mail draft failed: ${stderr.trim().slice(0, 500)}`);
console.log(JSON.stringify({ week, mode: prepare ? 'prepared' : 'draft', test, eventCount: issue.events.length, posterCount: issue.events.filter((event) => event.poster).length, recipientCount: recipients.length }));
