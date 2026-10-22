const { toDate, weekday, hhmm, addDays, dayStr } = require('./time');

// db = pg Pool or Client
async function getFreeSlots(db, storeId, day, durationMin) {
  const { rows: [store] } = await db.query(
    'select slot_minutes, capacity from salon_stores where store_id=$1', [storeId]);
  if (!store) return [];

  const hol = await db.query('select 1 from salon_holidays where store_id=$1 and day=$2', [storeId, day]);
  if (hol.rowCount) return [];

  const { rows: [h] } = await db.query(
    'select open_time, close_time from salon_hours where store_id=$1 and weekday=$2', [storeId, weekday(day)]);
  if (!h || !h.open_time || !h.close_time) return [];

  const open = toDate(day, h.open_time);
  const close = toDate(day, h.close_time);

  const { rows: appts } = await db.query(
    `select start_at, end_at from salon_appointments
      where store_id=$1 and status='confirmed' and start_at < $3 and end_at > $2`,
    [storeId, open, close]);

  const step = store.slot_minutes * 60000;
  const dur = durationMin * 60000;
  const minStart = Date.now() + 30 * 60000; // 30 min lead time
  const out = [];
  for (let t = open.getTime(); t + dur <= close.getTime(); t += step) {
    if (t < minStart) continue;
    const busy = appts.filter((a) => a.start_at.getTime() < t + dur && a.end_at.getTime() > t).length;
    if (busy < store.capacity) out.push(new Date(t));
  }
  return out;
}

// next days that still have free slots
async function getOpenDays(db, storeId, durationMin, maxDays = 7, lookahead = 21) {
  const days = [];
  const today = dayStr(new Date());
  for (let i = 0; i < lookahead && days.length < maxDays; i++) {
    const d = addDays(today, i);
    const slots = await getFreeSlots(db, storeId, d, durationMin);
    if (slots.length) days.push(d);
  }
  return days;
}

// Race-safe booking. Returns appointment row, or null if slot just got taken.
async function bookAppointment(pool, { storeId, service, phone, name, day, time }) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [storeId]);
    const slots = await getFreeSlots(client, storeId, day, service.duration_min);
    if (!slots.some((s) => hhmm(s) === time)) {
      await client.query('rollback');
      return null;
    }
    const start = toDate(day, time);
    const end = new Date(start.getTime() + service.duration_min * 60000);
    const within24 = start.getTime() - Date.now() <= 24 * 3600000;
    const { rows: [appt] } = await client.query(
      `insert into salon_appointments
         (store_id, service_id, customer_phone, customer_name, start_at, end_at, reminder24_sent)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [storeId, service.id, phone, name, start, end, within24]);
    await client.query('commit');
    return appt;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { getFreeSlots, getOpenDays, bookAppointment };
