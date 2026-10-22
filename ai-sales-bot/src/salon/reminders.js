const wa = require('./wa');
const connections = require('./connections');
const { fmtDate, fmtTime } = require('./time');

const TEMPLATE = process.env.SALON_REMINDER_TEMPLATE || 'appointment_reminder'; // body: "Hi {{1}}, reminder: your {{2}} appointment is on {{3}}. Reply MENU to reschedule or cancel."

async function sendReminder(pool, a, label) {
  const conn = await connections.byStore(pool, a.store_id);
  if (!conn) return false;
  const { rows: [sess] } = await pool.query(
    'select last_inbound_at from salon_sessions where store_id=$1 and wa_id=$2', [a.store_id, a.customer_phone]);
  const when = `${fmtDate(a.start_at)} at ${fmtTime(a.start_at)}`;
  const inWindow = sess?.last_inbound_at && Date.now() - new Date(sess.last_inbound_at).getTime() < 23 * 3600000;

  let r;
  if (inWindow) {
    r = await wa.sendText(conn, a.customer_phone,
      `⏰ Reminder (${label}): your *${a.service_name}* at ${a.store_name} is on ${when}.\nType *menu* to reschedule or cancel.`);
  } else {
    r = await wa.sendTemplate(conn, a.customer_phone, TEMPLATE, [a.customer_name || 'there', a.service_name, when]);
  }
  return r.ok;
}

async function runReminders(pool) {
  const base = `select a.*, s.name as service_name, st.name as store_name
                  from salon_appointments a
                  join salon_services s on s.id=a.service_id
                  join salon_stores st on st.store_id=a.store_id
                 where a.status='confirmed'`;
  let sent = 0;

  // 24h reminder (not for bookings made less than 3h before the visit)
  const r24 = await pool.query(
    `${base} and not a.reminder24_sent and a.start_at <= now() + interval '24 hours' and a.start_at > now() + interval '3 hours'`);
  for (const a of r24.rows) {
    if (await sendReminder(pool, a, 'tomorrow')) {
      await pool.query('update salon_appointments set reminder24_sent=true where id=$1', [a.id]); sent++;
    }
  }
  // 2h reminder
  const r2 = await pool.query(
    `${base} and not a.reminder2_sent and a.start_at <= now() + interval '2 hours' and a.start_at > now()`);
  for (const a of r2.rows) {
    if (await sendReminder(pool, a, 'today')) {
      await pool.query('update salon_appointments set reminder2_sent=true where id=$1', [a.id]); sent++;
    }
  }
  return sent;
}

module.exports = { runReminders };
