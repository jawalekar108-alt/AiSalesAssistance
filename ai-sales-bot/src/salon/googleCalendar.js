// Google Calendar via SERVICE ACCOUNT (no OAuth screens, fastest to set up).
// Owner shares their calendar with the service account email -> events appear on their phone.
// npm i googleapis
const { google } = require('googleapis');

let _cal = null;
function calendar() {
  if (_cal) return _cal;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const txt = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const creds = JSON.parse(txt);
  const auth = new google.auth.JWT(
    creds.client_email, null, creds.private_key.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/calendar']);
  _cal = google.calendar({ version: 'v3', auth });
  return _cal;
}

async function createEvent({ calendarId, summary, description, start, end }) {
  const cal = calendar();
  if (!cal || !calendarId) return null;
  const r = await cal.events.insert({
    calendarId,
    requestBody: {
      summary,
      description,
      start: { dateTime: new Date(start).toISOString(), timeZone: 'Asia/Kolkata' },
      end: { dateTime: new Date(end).toISOString(), timeZone: 'Asia/Kolkata' },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }] },
    },
  });
  return r.data.id;
}

async function deleteEvent(calendarId, eventId) {
  const cal = calendar();
  if (!cal || !calendarId || !eventId) return;
  await cal.events.delete({ calendarId, eventId }).catch((e) => console.error('[salon/gcal] delete', e.message));
}

module.exports = { createEvent, deleteEvent };
