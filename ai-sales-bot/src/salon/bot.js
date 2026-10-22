const wa = require('./wa');
const gcal = require('./googleCalendar');
const { getFreeSlots, getOpenDays, bookAppointment } = require('./availability');
const { fmtDate, fmtTime, hhmm, dayStr, addDays } = require('./time');

const { sendText, sendButtons, sendList, clip } = wa;
const rupee = (n) => '₹' + Number(n);
// "Add to my calendar" link: opens in the customer's Google Calendar / phone calendar
const iso = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const calendarLink = ({ title, start, end, details, location }) =>
  'https://calendar.google.com/calendar/render?' +
  new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${iso(start)}/${iso(end)}`,
    details: details || '',
    location: location || '',
  }).toString();

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const RECO = {
  bridal: ['bridal', 'makeup', 'party', 'wedding', 'saree draping'],
  skin: ['facial', 'skin', 'glow', 'cleanup', 'clean-up', 'detan', 'bleach'],
  hair: ['hair', 'cut', 'colour', 'color', 'keratin', 'smoothening', 'spa'],
  hands: ['manicure', 'pedicure', 'nail'],
  removal: ['wax', 'threading', 'laser', 'removal'],
  relax: ['massage', 'relax', 'spa', 'head massage'],
};

async function getSession(pool, storeId, waId) {
  const { rows } = await pool.query(
    `insert into salon_sessions(store_id, wa_id, last_inbound_at) values($1,$2,now())
     on conflict (store_id, wa_id) do update set last_inbound_at=now() returning *`, [storeId, waId]);
  return rows[0];
}
async function setSession(pool, storeId, waId, state, data) {
  await pool.query(
    'update salon_sessions set state=$3, data=$4, updated_at=now() where store_id=$1 and wa_id=$2',
    [storeId, waId, state, JSON.stringify(data || {})]);
}

async function handleMessage({ pool, conn, store, msg, profileName, llm }) {
  const to = msg.from;
  const sid = store.store_id;
  const sess = await getSession(pool, sid, to);
  let data = sess.data || {};
  const id = msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || null;
  const text = (msg.text?.body || '').trim();
  const save = (state = 'idle') => setSession(pool, sid, to, state, data);

  // ---------- helpers ----------
  const getService = async (sId) =>
    (await pool.query('select * from salon_services where id=$1 and store_id=$2 and active', [sId, sid])).rows[0];

  const hoursText = async () => {
    const { rows } = await pool.query('select * from salon_hours where store_id=$1 order by weekday', [sid]);
    const byDay = Object.fromEntries(rows.map((r) => [r.weekday, r]));
    const fmt = (t) => fmtTime(new Date(`2000-01-01T${String(t).slice(0, 5)}:00+05:30`));
    return [1, 2, 3, 4, 5, 6, 0]
      .map((d) => {
        const r = byDay[d];
        return `${DAYS[d]}: ${r && r.open_time ? `${fmt(r.open_time)} - ${fmt(r.close_time)}` : 'Closed'}`;
      })
      .join('\n');
  };

  const servicesText = async () => {
    const { rows } = await pool.query(
      'select * from salon_services where store_id=$1 and active order by category, price', [sid]);
    if (!rows.length) return 'Our service list is being updated. Please ask our team.';
    let out = `💅 *${store.name} – Services & Prices*\n`;
    let cat = '';
    for (const s of rows) {
      if (s.category !== cat) { cat = s.category; out += `\n*${cat}*\n`; }
      out += `• ${s.name} – ${rupee(s.price)} (${s.duration_min} min)\n`;
    }
    return out;
  };

  const menu = async (intro) => {
    await save('idle');
    return sendList(conn, to,
      intro || `Welcome to *${store.name}* ✨\nHow can I help you today?`,
      'Open menu',
      [
        { id: 'M_BOOK', title: '📅 Book appointment' },
        { id: 'M_SERVICES', title: '💅 Services & prices' },
        { id: 'M_HOURS', title: '🕘 Opening hours' },
        { id: 'M_RECO', title: '✨ Recommend for me' },
        { id: 'M_MY', title: '🗓 My appointments' },
        { id: 'M_HUMAN', title: '👩 Talk to our team' },
      ], 'Menu');
  };

  const serviceRows = (rows) =>
    rows.map((s) => ({ id: `svc:${s.id}`, title: s.name, description: `${rupee(s.price)} · ${s.duration_min} min` }));

  const pickService = async (category) => {
    if (!category) {
      const { rows: cats } = await pool.query(
        'select category, count(*) c from salon_services where store_id=$1 and active group by category order by category', [sid]);
      const total = cats.reduce((a, c) => a + Number(c.c), 0);
      if (total > 10) {
        return sendList(conn, to, 'What would you like to book?', 'Choose category',
          cats.slice(0, 10).map((c) => ({ id: `cat:${c.category}`, title: c.category, description: `${c.c} services` })), 'Categories');
      }
    }
    const { rows } = await pool.query(
      `select * from salon_services where store_id=$1 and active ${category ? 'and category=$2' : ''} order by price limit 10`,
      category ? [sid, category] : [sid]);
    if (!rows.length) return sendText(conn, to, 'No services found. Type *menu* to go back.');
    return sendList(conn, to, 'Pick a service to book 👇', 'Choose service', serviceRows(rows), 'Services');
  };

  const pickDate = async () => {
    const service = await getService(data.service_id);
    if (!service) return menu();
    const days = await getOpenDays(pool, sid, service.duration_min, 7);
    if (!days.length) return sendText(conn, to, 'Sorry, no slots are open in the next few weeks. Please contact us directly 🙏');
    await save('pick_date');
    return sendList(conn, to,
      `*${service.name}* – ${rupee(service.price)}\nWhich day works for you?`, 'Choose date',
      days.map((d) => ({ id: `date:${d}`, title: fmtDate(`${d}T12:00:00+05:30`) })), 'Dates');
  };

  const pickSlot = async (day) => {
    const service = await getService(data.service_id);
    if (!service) return menu();
    const slots = await getFreeSlots(pool, sid, day, service.duration_min);
    if (!slots.length) {
      await sendText(conn, to, 'That day is full. Please choose another date.');
      return pickDate();
    }
    data.day = day;
    await save('pick_slot');
    let chosen = slots;
    if (slots.length > 9) {
      const step = slots.length / 9;
      chosen = Array.from({ length: 9 }, (_, i) => slots[Math.floor(i * step)]);
    }
    const rows = chosen.map((s) => ({ id: `slot:${hhmm(s)}`, title: fmtTime(s) }));
    rows.push({ id: 'back:dates', title: '⬅ Pick another date' });
    return sendList(conn, to, `Available times on *${fmtDate(`${day}T12:00:00+05:30`)}*:`, 'Choose time', rows, 'Times');
  };

  const showConfirm = async () => {
    const service = await getService(data.service_id);
    await save('confirm');
    const start = new Date(`${data.day}T${data.time}:00+05:30`);
    return sendButtons(conn, to,
      `Please confirm your booking:\n\n💇 ${service.name}\n💰 ${rupee(service.price)}\n📅 ${fmtDate(start)}\n⏰ ${fmtTime(start)}\n👤 ${data.name || 'Guest'}\n📞 +${to}`,
      [{ id: 'confirm:yes', title: 'Confirm ✅' }, { id: 'confirm:no', title: 'Cancel ❌' }]);
  };

  const doBook = async () => {
    const service = await getService(data.service_id);
    if (!service || !data.day || !data.time) return menu();
    const appt = await bookAppointment(pool, {
      storeId: sid, service, phone: to, name: data.name || 'Guest', day: data.day, time: data.time,
    });
    if (!appt) {
      await sendText(conn, to, 'Sorry, that slot was just taken 😔 Please choose another time.');
      return pickSlot(data.day);
    }
    // Google Calendar (never blocks the booking)
    try {
      const eventId = await gcal.createEvent({
        calendarId: store.calendar_id,
        summary: `${service.name} – ${appt.customer_name}`,
        description: `Phone: +${to}\nPrice: ${rupee(service.price)}\nBooked via WhatsApp (#${appt.id})`,
        start: appt.start_at, end: appt.end_at,
      });
      if (eventId) await pool.query('update salon_appointments set gcal_event_id=$1 where id=$2', [eventId, appt.id]);
    } catch (e) { console.error('[salon] calendar error', e.message); }

    const addLink = calendarLink({
      title: `${service.name} at ${store.name}`,
      start: appt.start_at, end: appt.end_at,
      details: `Booking #${appt.id}`,
      location: store.address || store.name,
    });
    await sendText(conn, to,
      `✅ *Booking confirmed!*\n\n💇 ${service.name}\n📅 ${fmtDate(appt.start_at)}\n⏰ ${fmtTime(appt.start_at)}\n📍 ${store.name}${store.address ? '\n' + store.address : ''}\n\nBooking #${appt.id}. We'll remind you before your visit.\n\n📲 Add to your calendar:\n${addLink}\n\nType *menu* to reschedule or cancel.`);
    if (store.owner_phone) {
      sendText(conn, store.owner_phone,
        `🔔 New booking #${appt.id}\n${service.name}\n${fmtDate(appt.start_at)} ${fmtTime(appt.start_at)}\n${appt.customer_name} +${to}`).catch(() => {});
    }
    data = {};
    await save('idle');
  };

  const myAppointments = async () => {
    const { rows } = await pool.query(
      `select a.*, s.name as service_name from salon_appointments a join salon_services s on s.id=a.service_id
        where a.store_id=$1 and a.customer_phone=$2 and a.status='confirmed' and a.start_at > now()
        order by a.start_at limit 10`, [sid, to]);
    if (!rows.length) return sendButtons(conn, to, 'You have no upcoming appointments.', [{ id: 'M_BOOK', title: 'Book now' }]);
    return sendList(conn, to, 'Your upcoming appointments.\nTap one to cancel it:', 'My bookings',
      rows.map((a) => ({
        id: `cancel:${a.id}`, title: `#${a.id} ${fmtDate(a.start_at)}`,
        description: `${a.service_name} · ${fmtTime(a.start_at)}`,
      })), 'Appointments');
  };

  const cancelAppt = async (apptId) => {
    const { rows: [a] } = await pool.query(
      `update salon_appointments set status='cancelled' where id=$1 and store_id=$2 and customer_phone=$3 and status='confirmed' returning *`,
      [apptId, sid, to]);
    if (!a) return sendText(conn, to, 'Could not find that appointment.');
    await gcal.deleteEvent(store.calendar_id, a.gcal_event_id);
    await sendText(conn, to, `Your appointment #${a.id} on ${fmtDate(a.start_at)} ${fmtTime(a.start_at)} is cancelled. Type *menu* to book again.`);
    if (store.owner_phone) {
      sendText(conn, store.owner_phone, `❌ Booking #${a.id} cancelled by +${to} (${fmtDate(a.start_at)} ${fmtTime(a.start_at)})`).catch(() => {});
    }
  };

  const reco = async (key) => {
    const pattern = (RECO[key] || []).map((w) => w.replace(/[^a-z0-9 -]/gi, '')).join('|');
    let { rows } = await pool.query(
      `select * from salon_services where store_id=$1 and active
         and (name||' '||category||' '||coalesce(tags,'')||' '||coalesce(description,'')) ~* $2 order by price limit 8`,
      [sid, pattern || 'zzzz']);
    if (!rows.length) {
      ({ rows } = await pool.query('select * from salon_services where store_id=$1 and active order by price limit 8', [sid]));
    }
    return sendList(conn, to, 'Here are my top picks for you ✨\nTap one to book:', 'See options', serviceRows(rows), 'Recommended');
  };

  // ---------- routing ----------
  try {
    if (id) {
      if (id === 'M_BOOK') return pickService();
      if (id === 'M_SERVICES') {
        await sendText(conn, to, await servicesText());
        return sendButtons(conn, to, 'Would you like to book?', [{ id: 'M_BOOK', title: 'Book now' }, { id: 'M_RECO', title: 'Recommend' }]);
      }
      if (id === 'M_HOURS') {
        await sendText(conn, to, `🕘 *Opening hours*\n${await hoursText()}${store.address ? `\n\n📍 ${store.address}` : ''}`);
        return sendButtons(conn, to, 'Anything else?', [{ id: 'M_BOOK', title: 'Book now' }]);
      }
      if (id === 'M_RECO') {
        return sendList(conn, to, 'What are you looking for? ✨', 'Choose one', [
          { id: 'reco:bridal', title: 'Bridal / Party look' },
          { id: 'reco:skin', title: 'Glowing skin' },
          { id: 'reco:hair', title: 'Hair care & styling' },
          { id: 'reco:hands', title: 'Hands & feet' },
          { id: 'reco:removal', title: 'Waxing / Threading' },
          { id: 'reco:relax', title: 'Relax & massage' },
        ], 'Preferences');
      }
      if (id === 'M_MY') return myAppointments();
      if (id === 'M_HUMAN') {
        await sendText(conn, to, `Our team will get back to you shortly 🙏${store.owner_phone ? `\nYou can also call: +${store.owner_phone}` : ''}`);
        if (store.owner_phone) sendText(conn, store.owner_phone, `👩 Customer +${to} (${profileName || 'unknown'}) wants to talk to you.`).catch(() => {});
        return;
      }
      if (id.startsWith('reco:')) return reco(id.slice(5));
      if (id.startsWith('cat:')) return pickService(id.slice(4));
      if (id.startsWith('svc:')) {
        data = { service_id: Number(id.slice(4)), name: profileName || null };
        return pickDate();
      }
      if (id === 'back:dates') return pickDate();
      if (id.startsWith('date:')) return pickSlot(id.slice(5));
      if (id.startsWith('slot:')) {
        data.time = id.slice(5);
        if (!data.name) { await save('await_name'); return sendText(conn, to, 'May I have your name for the booking?'); }
        return showConfirm();
      }
      if (id === 'confirm:yes') return doBook();
      if (id === 'confirm:no') { data = {}; return menu('Booking cancelled. Anything else?'); }
      if (id.startsWith('cancel:')) return cancelAppt(Number(id.slice(7)));
      return menu();
    }

    // ---------- free text ----------
    if (sess.state === 'await_name' && text) {
      data.name = clip(text, 60);
      return showConfirm();
    }
    const t = text.toLowerCase();
    if (!t || /^(hi+|hello+|hey+|menu|start|namaste|hola|help)\b/.test(t)) return menu();
    if (/\b(cancel|reschedule|my booking|my appointment)\b/.test(t)) return myAppointments();
    if (/\b(book|appointment|slot)\b/.test(t)) return pickService();

    if (llm) {
      const { rows: svc } = await pool.query(
        'select name,category,price,duration_min,description from salon_services where store_id=$1 and active', [sid]);
      const system =
        `You are the WhatsApp assistant of "${store.name}", a beauty parlour. Answer ONLY from the data below. ` +
        `Be warm, short (max 4 lines), use simple English. Never invent prices or timings. ` +
        `If the customer wants to book, tell them to type *book*. If unsure, say the team will help.\n\n` +
        `SERVICES:\n${svc.map((s) => `${s.name} (${s.category}) ${rupee(s.price)} ${s.duration_min}min ${s.description || ''}`).join('\n')}\n\n` +
        `HOURS:\n${await hoursText()}\n${store.address ? 'ADDRESS: ' + store.address : ''}`;
      const reply = await llm({ system, user: text });
      if (reply) {
        await sendText(conn, to, reply);
        return sendButtons(conn, to, 'Need anything else?', [{ id: 'M_BOOK', title: 'Book now' }, { id: 'M_RECO', title: 'Recommend' }]);
      }
    }
    if (/\b(price|rate|cost|service|charges?)\b/.test(t)) {
      await sendText(conn, to, await servicesText());
      return sendButtons(conn, to, 'Would you like to book?', [{ id: 'M_BOOK', title: 'Book now' }]);
    }
    if (/\b(time|timing|open|close|hours?|address|location)\b/.test(t)) {
      await sendText(conn, to, `🕘 *Opening hours*\n${await hoursText()}${store.address ? `\n\n📍 ${store.address}` : ''}`);
      return;
    }
    return menu();
  } catch (e) {
    console.error('[salon] handler error', e);
    await sendText(conn, to, 'Sorry, something went wrong. Type *menu* to start again 🙏').catch(() => {});
  }
}

module.exports = { handleMessage };