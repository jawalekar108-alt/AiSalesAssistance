//21/10

const express = require('express');
const { handleMessage } = require('./bot');
const { runReminders } = require('./reminders');
const connections = require('./connections');
const wa = require('./wa');
const gcal = require('./googleCalendar');
const { fmtDate, fmtTime, hhmm, dayStr } = require('./time');
const { getFreeSlots, bookAppointment } = require('./availability');

const GRAPH = process.env.META_GRAPH_VERSION || process.env.GRAPH_VERSION || 'v23.0';
const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;
const DEFAULT_HOURS = { 0: null, 1: ['10:00', '20:00'], 2: ['10:00', '20:00'], 3: ['10:00', '20:00'], 4: ['10:00', '20:00'], 5: ['10:00', '20:00'], 6: ['10:00', '20:00'] };

const httpError = (status, message) => Object.assign(new Error(message), { status });
const clipText = (v, n) => String(v ?? '').trim().slice(0, n);

/*
 * pool              : pg Pool (Supabase)
 * llm               : optional ({system,user}) => text
 * isReservedPhone   : (phoneNumberId) => true when that number already belongs to a SALES store
 *                     (so a parlour can never take over a clothing store's number)
 */
function init({ pool, llm = null, isReservedPhone = () => false }) {
  const seen = new Set(); // dedupe Meta webhook retries
  const router = express.Router();
  router.use('/api/salon', express.json());

  const getConn = (phoneNumberId) => connections.byPhoneId(pool, phoneNumberId);

  const phoneIds = (body) =>
    (body?.entry || []).flatMap((e) => (e.changes || []).map((c) => c.value?.metadata?.phone_number_id)).filter(Boolean);

  // true if this webhook payload belongs to a parlour number
  async function owns(body) {
    for (const pid of phoneIds(body)) if (await getConn(pid)) return true;
    return false;
  }

  // process messages (call AFTER you already answered 200 to Meta)
  async function processWebhook(body) {
    for (const entry of body?.entry || []) {
      for (const ch of entry.changes || []) {
        const v = ch.value;
        if (!v?.messages?.length) continue;
        const conn = await getConn(v.metadata?.phone_number_id);
        if (!conn) continue;
        const { rows: [store] } = await pool.query('select * from salon_stores where store_id=$1', [conn.store_id]);
        if (!store) continue;
        for (const msg of v.messages) {
          if (seen.has(msg.id)) continue;
          seen.add(msg.id);
          if (seen.size > 2000) seen.delete(seen.values().next().value);
          const profileName = v.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name || null;
          await handleMessage({ pool, conn, store, msg, profileName, llm });
        }
      }
    }
  }

  /* ============================================================
   * SHARED ACTIONS (used by the admin-key API and by the dashboard)
   * ============================================================ */

  async function saveStore(body) {
    const { store_id, name, owner_phone, calendar_id, address, hours, services = [] } = body || {};
    if (!store_id || !clipText(name, 100)) throw httpError(400, 'store_id and name are required');

    const capacity = Math.min(50, Math.max(1, Math.floor(Number(body.capacity)) || 1));
    const slotMinutes = Math.min(240, Math.max(10, Math.floor(Number(body.slot_minutes)) || 30));

    const h = hours || DEFAULT_HOURS;
    const hourRows = [];

    for (const [d, v] of Object.entries(h)) {
      const day = Number(d);
      if (!Number.isInteger(day) || day < 0 || day > 6) throw httpError(400, `Bad weekday ${d}`);
      if (v === null || v === undefined) { hourRows.push([day, null, null]); continue; }
      if (!Array.isArray(v) || !HHMM.test(v[0]) || !HHMM.test(v[1])) throw httpError(400, `Opening hours must look like 10:00 and 20:00 (${d})`);
      if (v[0].padStart(5, '0') >= v[1].padStart(5, '0')) throw httpError(400, 'Closing time must be after opening time');
      hourRows.push([day, v[0], v[1]]);
    }

    const cleanServices = (Array.isArray(services) ? services : []).slice(0, 200).map((s, i) => {
      const price = Number(s.price);
      const nm = clipText(s.name, 80);
      if (!nm) throw httpError(400, `Service ${i + 1}: name is missing`);
      if (!Number.isFinite(price) || price < 0) throw httpError(400, `Service "${nm}": price must be a number`);
      return {
        name: nm,
        category: clipText(s.category, 40) || 'General',
        price,
        duration_min: Math.min(480, Math.max(5, Math.floor(Number(s.duration_min)) || 30)),
        description: clipText(s.description, 300) || null,
        tags: clipText(s.tags, 200),
      };
    });

    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(
        `insert into salon_stores(store_id,name,owner_phone,calendar_id,address,capacity,slot_minutes)
         values($1,$2,$3,$4,$5,$6,$7)
         on conflict (store_id) do update set name=$2, owner_phone=$3, calendar_id=$4, address=$5, capacity=$6, slot_minutes=$7`,
        [String(store_id), clipText(name, 100), String(owner_phone || '').replace(/\D/g, '') || null, clipText(calendar_id, 200) || null, clipText(address, 300) || null, capacity, slotMinutes]);

      for (const [day, open, close] of hourRows) {
        await c.query(
          `insert into salon_hours(store_id,weekday,open_time,close_time) values($1,$2,$3,$4)
           on conflict (store_id,weekday) do update set open_time=$3, close_time=$4`,
          [String(store_id), day, open, close]);
      }

      if (cleanServices.length) {
        // old services that already have bookings are only hidden; the rest are removed (no duplicates)
        await c.query('update salon_services set active=false where store_id=$1', [String(store_id)]);
        await c.query('delete from salon_services where store_id=$1 and not exists (select 1 from salon_appointments a where a.service_id=salon_services.id)', [String(store_id)]);
        for (const s of cleanServices) {
          await c.query(
            `insert into salon_services(store_id,name,category,price,duration_min,description,tags) values($1,$2,$3,$4,$5,$6,$7)`,
            [String(store_id), s.name, s.category, s.price, s.duration_min, s.description, s.tags]);
        }
      }
      await c.query('commit');
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async function connectNumber({ store_id, phone_number_id, waba_id, access_token, display_phone }) {
    const pid = String(phone_number_id || '').trim();
    const waba = String(waba_id || '').trim();
    const token = String(access_token || '').trim().replace(/^Bearer\s+/i, '');

    if (!store_id) throw httpError(400, 'store_id is required');
    if (!/^\d{5,25}$/.test(pid)) throw httpError(400, 'Phone number ID must be digits only');
    if (waba && !/^\d{5,25}$/.test(waba)) throw httpError(400, 'WhatsApp Business Account ID must be digits only');
    if (token.length < 20) throw httpError(400, 'Access token is missing');

    const { rows: [store] } = await pool.query('select store_id from salon_stores where store_id=$1', [String(store_id)]);
    if (!store) throw httpError(400, 'Save the parlour details first, then connect the number');

    if (isReservedPhone(pid)) throw httpError(409, 'This number is already used by a sales store. Use a different WhatsApp number for the parlour.');

    const { rows: [clash] } = await pool.query('select store_id from salon_wa_connections where phone_number_id=$1', [pid]);
    if (clash && String(clash.store_id) !== String(store_id)) throw httpError(409, 'This WhatsApp number is already connected to another parlour.');

    // never trust what was typed: ask Meta whether this token can really read this number
    const pr = await fetch(`https://graph.facebook.com/${GRAPH}/${pid}?fields=display_phone_number,verified_name`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const phone = await pr.json().catch(() => ({}));
    if (!pr.ok) throw httpError(400, `Meta rejected this token / Phone number ID: ${phone?.error?.message || 'HTTP ' + pr.status}`);

    // one number per parlour
    await pool.query('delete from salon_wa_connections where store_id=$1 and phone_number_id<>$2', [String(store_id), pid]);
    await pool.query(
      `insert into salon_wa_connections(phone_number_id,store_id,waba_id,access_token,display_phone) values($1,$2,$3,$4,$5)
       on conflict (phone_number_id) do update set store_id=$2, waba_id=$3, access_token=$4, display_phone=$5`,
      [pid, String(store_id), waba || null, connections.seal(token), clipText(display_phone, 30) || phone.display_phone_number || null]);

    let subscribe = null;
    if (waba) {
      const r = await fetch(`https://graph.facebook.com/${GRAPH}/${waba}/subscribed_apps`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      subscribe = await r.json().catch(() => ({}));
    }
    return { display_phone: phone.display_phone_number || null, verified_name: phone.verified_name || null, subscribe };
  }

  async function healthFor(storeId) {
    const checks = [];
    const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: detail || '' });

    const conn = await connections.byStore(pool, storeId);
    if (!conn) {
      add('WhatsApp number saved for this parlour', false, 'Not connected yet');
      return { all_ok: false, checks };
    }
    add('WhatsApp number saved for this parlour', true, `phone_number_id ${conn.phone_number_id}`);

    const headers = { Authorization: `Bearer ${conn.access_token}` };
    const pr = await fetch(`https://graph.facebook.com/${GRAPH}/${conn.phone_number_id}?fields=display_phone_number,verified_name,status,platform_type`, { headers });
    const phone = await pr.json().catch(() => ({}));

    if (!pr.ok) {
      add('Token works and can read the number', false, (phone?.error?.message || `HTTP ${pr.status}`) + (phone?.error?.code === 190 ? ' (token expired - make a permanent System User token)' : ''));
    } else {
      add('Token works and can read the number', true, `${phone.display_phone_number || ''} (${phone.verified_name || 'no name'})`);
      add('Number status is CONNECTED', phone.status === 'CONNECTED', `status: ${phone.status || 'unknown'}`);
      add('Number runs on Cloud API', phone.platform_type === 'CLOUD_API', `platform: ${phone.platform_type || 'unknown'}`);
    }

    if (conn.waba_id) {
      const sr = await fetch(`https://graph.facebook.com/${GRAPH}/${conn.waba_id}/subscribed_apps`, { headers });
      const subs = await sr.json().catch(() => ({}));
      const list = Array.isArray(subs?.data) ? subs.data : [];
      add('Messages are delivered to this app (subscribed_apps)', list.length > 0, list.length ? 'subscribed' : 'No app subscribed - customer messages will NOT arrive');
    }
    return { all_ok: checks.every((c) => c.ok), checks };
  }

  async function getState(storeId) {
    const { rows: [store] } = await pool.query('select * from salon_stores where store_id=$1', [String(storeId)]);
    if (!store) return { exists: false };

    const [hours, services, holidays, conn] = await Promise.all([
      pool.query('select weekday, open_time, close_time from salon_hours where store_id=$1', [store.store_id]),
      pool.query('select id, name, category, price, duration_min, description, tags from salon_services where store_id=$1 and active order by category, price', [store.store_id]),
      pool.query('select day from salon_holidays where store_id=$1 and day >= current_date order by day', [store.store_id]),
      connections.byStore(pool, store.store_id),
    ]);

    const h = {};
    for (const r of hours.rows) h[r.weekday] = r.open_time && r.close_time ? [String(r.open_time).slice(0, 5), String(r.close_time).slice(0, 5)] : null;

    return {
      exists: true,
      store: {
        store_id: store.store_id, name: store.name, owner_phone: store.owner_phone || '', calendar_id: store.calendar_id || '',
        address: store.address || '', capacity: store.capacity, slot_minutes: store.slot_minutes,
      },
      hours: h,
      services: services.rows.map((s) => ({ ...s, price: Number(s.price) })),
      holidays: holidays.rows.map((r) => (r.day instanceof Date ? r.day.toLocaleDateString('en-CA') : String(r.day).slice(0, 10))),
      whatsapp: conn ? { connected: true, phone_number_id: conn.phone_number_id, display_phone: conn.display_phone || '' } : { connected: false },
    };
  }

  async function listAppointments(storeId, when = 'upcoming') {
    const upcoming = when !== 'past';
    const { rows } = await pool.query(
      `select a.id, a.customer_name, a.customer_phone, s.name as service, s.price, a.start_at, a.status
         from salon_appointments a join salon_services s on s.id=a.service_id
        where a.store_id=$1 and ${upcoming ? "a.start_at >= now() - interval '2 hours'" : 'a.start_at < now()'}
        order by a.start_at ${upcoming ? 'asc' : 'desc'} limit 200`, [String(storeId)]);
    return rows;
  }

  async function cancelAppointment(storeId, id) {
    const { rows: [a] } = await pool.query(
      `update salon_appointments set status='cancelled' where id=$1 and store_id=$2 and status='confirmed' returning *`,
      [Number(id), String(storeId)]);
    if (!a) throw httpError(404, 'Booking not found or already cancelled');

    const { rows: [store] } = await pool.query('select * from salon_stores where store_id=$1', [String(storeId)]);
    await gcal.deleteEvent(store?.calendar_id, a.gcal_event_id);

    const conn = await connections.byStore(pool, storeId);
    if (conn) {
      wa.sendText(conn, a.customer_phone,
        `Sorry, your appointment #${a.id} on ${fmtDate(a.start_at)} at ${fmtTime(a.start_at)} at ${store?.name || 'our parlour'} had to be cancelled. Type *menu* to book another time 🙏`
      ).catch(() => {});
    }
    return a;
  }

  // numbers for the owner's overview screen (India time)
  async function getStats(storeId) {
    const sid = String(storeId);
    const local = "(a.start_at at time zone 'Asia/Kolkata')";
    const nowLocal = "(now() at time zone 'Asia/Kolkata')";

    const { rows: [n] } = await pool.query(
      `select
         count(*) filter (where a.status='confirmed' and ${local}::date = ${nowLocal}::date) as today,
         count(*) filter (where a.status='confirmed' and a.start_at >= now() and a.start_at < now() + interval '7 days') as next7,
         count(*) filter (where a.status in ('confirmed','completed') and date_trunc('month', ${local}) = date_trunc('month', ${nowLocal})) as month_bookings,
         coalesce(sum(s.price) filter (where a.status in ('confirmed','completed') and date_trunc('month', ${local}) = date_trunc('month', ${nowLocal})), 0) as month_value,
         count(*) filter (where a.status='cancelled' and date_trunc('month', ${local}) = date_trunc('month', ${nowLocal})) as month_cancelled,
         count(distinct a.customer_phone) as customers
       from salon_appointments a join salon_services s on s.id=a.service_id
       where a.store_id=$1`, [sid]);

    const { rows: schedule } = await pool.query(
      `select a.id, a.customer_name, a.customer_phone, s.name as service, s.price, a.start_at, a.status
         from salon_appointments a join salon_services s on s.id=a.service_id
        where a.store_id=$1 and a.status in ('confirmed','completed','no_show') and ${local}::date = ${nowLocal}::date
        order by a.start_at`, [sid]);

    return {
      today: Number(n.today), next7: Number(n.next7), month_bookings: Number(n.month_bookings),
      month_value: Number(n.month_value), month_cancelled: Number(n.month_cancelled), customers: Number(n.customers),
      schedule,
    };
  }

  async function listCustomers(storeId) {
    const { rows } = await pool.query(
      `select a.customer_phone as phone, max(a.customer_name) as name,
              count(*) filter (where a.status in ('confirmed','completed')) as bookings,
              max(a.start_at) filter (where a.status in ('confirmed','completed') and a.start_at < now()) as last_visit,
              min(a.start_at) filter (where a.status='confirmed' and a.start_at >= now()) as next_visit,
              coalesce(sum(s.price) filter (where a.status in ('confirmed','completed') and a.start_at < now()), 0) as spent
         from salon_appointments a join salon_services s on s.id=a.service_id
        where a.store_id=$1
        group by a.customer_phone
        order by max(a.start_at) desc limit 300`, [String(storeId)]);
    return rows.map((r) => ({ ...r, bookings: Number(r.bookings), spent: Number(r.spent) }));
  }

  // owner marks a visit as done / no-show (or puts it back to confirmed)
  async function setAppointmentStatus(storeId, id, status) {
    if (!['completed', 'no_show', 'confirmed'].includes(status)) throw httpError(400, 'Bad status');
    const { rows: [a] } = await pool.query(
      `update salon_appointments set status=$3 where id=$1 and store_id=$2 and status in ('confirmed','completed','no_show') returning id, status`,
      [Number(id), String(storeId), status]);
    if (!a) throw httpError(404, 'Booking not found (a cancelled booking cannot be changed)');
    return a;
  }

  async function storeExists(storeId) {
    const { rowCount } = await pool.query('select 1 from salon_stores where store_id=$1', [String(storeId)]);
    return rowCount > 0;
  }

  async function listStores() {
    const { rows } = await pool.query('select store_id, name from salon_stores order by name');
    return rows;
  }

  // free start times for one service on one day
  async function freeSlots(storeId, serviceId, day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw httpError(400, 'Pick a date');
    if (day < dayStr(new Date())) throw httpError(400, 'That date is in the past');

    const { rows: [service] } = await pool.query('select * from salon_services where id=$1 and store_id=$2 and active', [Number(serviceId), String(storeId)]);
    if (!service) throw httpError(404, 'Service not found');

    const slots = await getFreeSlots(pool, String(storeId), day, service.duration_min);
    return slots.map((s) => ({ time: hhmm(s), label: fmtTime(s) }));
  }

  // booking made by the parlour itself (phone call / walk-in), same rules as the WhatsApp bot
  async function createBooking({ storeId, serviceId, day, time, name, phone, notify = true }) {
    const digits = String(phone || '').replace(/\D/g, '');
    const full = digits.length === 10 ? '91' + digits : digits; // 10 digits = Indian number

    if (full.length < 11 || full.length > 15) throw httpError(400, 'Enter the customer phone with country code, e.g. 919876543210');
    if (!clipText(name, 60)) throw httpError(400, 'Enter the customer name');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day)) || !/^\d{1,2}:\d{2}$/.test(String(time))) throw httpError(400, 'Choose a date and time');

    const { rows: [service] } = await pool.query('select * from salon_services where id=$1 and store_id=$2 and active', [Number(serviceId), String(storeId)]);
    if (!service) throw httpError(404, 'Service not found');

    const appt = await bookAppointment(pool, { storeId: String(storeId), service, phone: full, name: clipText(name, 60), day, time: String(time).padStart(5, '0') });
    if (!appt) throw httpError(409, 'That time was just taken. Pick another time.');

    const { rows: [store] } = await pool.query('select * from salon_stores where store_id=$1', [String(storeId)]);

    let calendar = false;
    try {
      const eventId = await gcal.createEvent({
        calendarId: store.calendar_id,
        summary: `${service.name} - ${appt.customer_name}`,
        description: `Phone: +${full}\nPrice: Rs ${Number(service.price)}\nBooked by the parlour (#${appt.id})`,
        start: appt.start_at, end: appt.end_at,
      });
      if (eventId) { await pool.query('update salon_appointments set gcal_event_id=$1 where id=$2', [eventId, appt.id]); calendar = true; }
    } catch (e) { console.error('[salon] calendar error', e.message); }

    let notified = false;
    if (notify) {
      const conn = await connections.byStore(pool, storeId);
      if (conn) {
        const r = await wa.sendText(conn, full,
          `✅ *Booking confirmed!*\n\n💇 ${service.name}\n📅 ${fmtDate(appt.start_at)}\n⏰ ${fmtTime(appt.start_at)}\n📍 ${store.name}${store.address ? '\n' + store.address : ''}\n\nBooking #${appt.id}. Reply *menu* anytime to reschedule or cancel.`);
        notified = r.ok;
      }
    }
    return { appointment: appt, calendar, notified };
  }

  async function addHoliday(storeId, day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw httpError(400, 'Pick a date');
    await pool.query('insert into salon_holidays(store_id,day) values($1,$2) on conflict do nothing', [String(storeId), day]);
  }

  async function removeHoliday(storeId, day) {
    await pool.query('delete from salon_holidays where store_id=$1 and day=$2', [String(storeId), day]);
  }

  /* ============================================================
   * ROUTES
   * ============================================================ */

  router.get('/api/salon/cron', async (req, res) => {
    const key = req.query.key || (req.headers.authorization || '').replace('Bearer ', '');
    if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });
    try { res.json({ sent: await runReminders(pool) }); }
    catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  // ---------- admin (x-admin-key) ----------
  const admin = (req, res, next) => {
    if (!process.env.SALON_ADMIN_KEY || req.headers['x-admin-key'] !== process.env.SALON_ADMIN_KEY)
      return res.status(401).json({ error: 'unauthorized' });
    next();
  };

  const wrap = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) {
      if (!e.status) console.error('[salon]', e);
      res.status(e.status || 500).json({ error: e.message });
    }
  };

  router.post('/api/salon/admin/store', admin, wrap(async (req) => { await saveStore(req.body); return { ok: true }; }));
  router.post('/api/salon/admin/connect', admin, wrap(async (req) => ({ ok: true, ...(await connectNumber(req.body)) })));
  router.get('/api/salon/admin/health', admin, wrap((req) => healthFor(req.query.store_id)));
  router.post('/api/salon/admin/holiday', admin, wrap(async (req) => { await addHoliday(req.body.store_id, req.body.day); return { ok: true }; }));
  router.get('/api/salon/admin/appointments', admin, wrap(async (req) => [...(await listAppointments(req.query.store_id, 'upcoming')), ...(await listAppointments(req.query.store_id, 'past'))]));

  return {
    router, owns, process: processWebhook, runReminders: () => runReminders(pool),
    saveStore, connectNumber, healthFor, getState, listAppointments, cancelAppointment, addHoliday, removeHoliday,
    storeExists, listStores, freeSlots, createBooking, getStats, listCustomers, setAppointmentStatus,
  };
}

module.exports = { init };

