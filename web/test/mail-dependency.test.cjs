'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const parseAddress = require('nodemailer/lib/addressparser');

// Grammar-equivalent versions of the upstream reviewed examples. The reserved
// .invalid domains make every address explicitly fictional. Parsing and stream
// transport below never establish an SMTP connection or send a message.
function mailboxes(values) {
  return values.flatMap(value => value.group ? mailboxes(value.group) : value.address ? [value.address] : []);
}

test('mail recipient parser keeps nested comments out of recipients (GHSA-8c8m-p3m8-cjg8)', () => {
  const value = 'Approved (x(y) <other@outside.invalid>) <approved@inside.invalid>';
  assert.deepEqual(mailboxes(parseAddress(value)), ['approved@inside.invalid']);
});

test('mail recipient parser keeps semicolons inside group comments and quotes (GHSA-m943-m63m-w62w)', () => {
  const values = [
    'G: (a; <other@outside.invalid>) <approved@inside.invalid>;',
    'G: "a;" "<other@outside.invalid>" <approved@inside.invalid>;'
  ];
  for (const value of values) assert.deepEqual(mailboxes(parseAddress(value)), ['approved@inside.invalid']);
});

test('mail recipient parser preserves the real domain after a quoted angle bracket (GHSA-85x2-q946-cp5h)', () => {
  const value = '<"a@outside.invalid>"@inside.invalid>';
  assert.deepEqual(mailboxes(parseAddress(value)), ['"a@outside.invalid>"@inside.invalid']);
});

test('offline backup email composition preserves its recipient and attachment without SMTP', async () => {
  const attachment = Buffer.from('Fictional encrypted backup fixture\0\x01\x02', 'utf8');
  const transport = nodemailer.createTransport({streamTransport: true, buffer: true, newline: 'unix', disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false});
  const result = await transport.sendMail({
    from: {name: 'FIBER net lb fictional backups', address: 'sender@inside.invalid'},
    to: 'approved@inside.invalid',
    subject: 'Fictional backup transport regression',
    text: 'Fictional backup only. No provider or SMTP server is selected.',
    attachments: [{filename: 'fictional-backup.fnbak', content: attachment, contentType: 'application/octet-stream'}]
  });
  assert.deepEqual(result.envelope, {from: 'sender@inside.invalid', to: ['approved@inside.invalid']});
  assert(Buffer.isBuffer(result.message));
  const message = result.message.toString('utf8');
  assert.match(message, /^To: approved@inside\.invalid\r?$/m);
  assert.match(message, /Content-Type: multipart\/mixed;/i);
  assert.match(message, /Content-Type: application\/octet-stream;/i);
  assert.match(message, /Content-Disposition: attachment; filename=fictional-backup\.fnbak/i);
  assert(message.includes(attachment.toString('base64')), 'the offline MIME message retains the complete binary attachment');
});
