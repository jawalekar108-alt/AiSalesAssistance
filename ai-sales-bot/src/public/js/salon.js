/* ============================================================
 * BEAUTY PARLOUR TAB  (appointment booking bot)
 *
 * - Admin: sees the tab always and picks which business to set up.
 * - Business owner: sees the tab only when a parlour was set up for their store.
 *   (Parlour owners then see only this tab.)
 * Everything is drawn into <section id="tab-salon"> by this file.
 * ============================================================ */

(function () {
  const API = '/api/salon-app';
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  let isAdmin = false;
  let storeId = '';
  let serviceAccount = null;
  let bookingsWhen = 'upcoming';
  let started = false;
  let services = [];

  const $ = id => document.getElementById(id);

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  const val = id => ($(id)?.value || '').trim();

  function say(id, text, ok) {
    const el = $(id);
    if (!el) return;
    el.style.color = ok ? '#34d399' : '#f87171';
    el.textContent = text || '';
  }

  async function api(path, method = 'GET', body) {
    const sep = path.includes('?') ? '&' : '?';
    const url = API + path + (isAdmin && storeId ? `${sep}store_id=${encodeURIComponent(storeId)}` : '');

    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify({ ...body, ...(isAdmin && storeId ? { store_id: storeId } : {}) }) : undefined
    });

    let data = null;

    try {
      data = await res.json();
    } catch {
      throw new Error(`Server did not return JSON (HTTP ${res.status}). Restart the server or log in again.`);
    }

    if (!res.ok || data.success === false) throw new Error(data.message || data.error || `HTTP ${res.status}`);

    return data;
  }

  /* ---------------- screen ---------------- */

  const FIELD = 'border: 1px solid var(--border-color);';
  const LABEL = 'font-size: 0.72rem; color: var(--text-muted); font-weight: 700;';

  function field(label, inner) {
    return `<div><label style="${LABEL}">${label}</label>${inner}</div>`;
  }

  function buildScreen() {
    const section = $('tab-salon');
    if (!section) return false;

    const hoursRows = [1, 2, 3, 4, 5, 6, 0]
      .map(
        d => `
        <div style="display:grid;grid-template-columns:90px 1fr 1fr;gap:0.5rem;align-items:center;margin-top:0.35rem;">
          <span style="font-size:0.8rem;color:var(--text-secondary);">${DAY_NAMES[d]}</span>
          <input id="sl-o${d}" class="phone-input" placeholder="open  e.g. 10:00" style="${FIELD}">
          <input id="sl-c${d}" class="phone-input" placeholder="close e.g. 20:00" style="${FIELD}">
        </div>`
      )
      .join('');

    section.innerHTML = `
      ${
        isAdmin
          ? `<div class="glass-panel" style="padding:1rem 1.25rem;margin-bottom:1rem;display:flex;gap:0.6rem;align-items:center;flex-wrap:wrap;">
               <strong style="font-size:0.85rem;">Business:</strong>
               <select id="sl-store-pick" class="phone-input" style="width:260px;${FIELD}" onchange="salonPickStore()"></select>
               <a id="sl-open-owner" href="#" target="_blank" style="display:none;font-size:0.8rem;color:#f472b6;">Open this parlour's own dashboard ↗</a>
               <span style="font-size:0.75rem;color:var(--text-secondary);">The business must have signed up first (it gets its own login).</span>
             </div>`
          : ''
      }

      <div id="sl-body">
        <div class="glass-panel" style="padding:1.5rem;margin-bottom:1rem;">
          <h3 style="font-size:1.15rem;margin-bottom:0.25rem;"><i class="fas fa-spa" style="color:#f472b6;"></i> Parlour details</h3>
          <p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:0.9rem;">The WhatsApp bot answers questions, recommends services and books appointments from this information.</p>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.7rem;">
            ${field('PARLOUR NAME *', `<input id="sl-name" class="phone-input" placeholder="Glow Beauty Parlour" style="${FIELD}">`)}
            ${field('OWNER WHATSAPP (country code, digits)', `<input id="sl-owner" class="phone-input" placeholder="919876543210" style="${FIELD}">`)}
            ${field('GOOGLE CALENDAR ID', `<input id="sl-cal" class="phone-input" placeholder="your@gmail.com or xxx@group.calendar.google.com" style="${FIELD}">`)}
            ${field('ADDRESS', `<input id="sl-address" class="phone-input" placeholder="Shop 4, Main Road, Hyderabad" style="${FIELD}">`)}
            ${field('CHAIRS / STAFF AT THE SAME TIME', `<input id="sl-cap" type="number" min="1" max="50" value="1" class="phone-input" style="${FIELD}">`)}
            ${field('SLOT EVERY (minutes)', `<input id="sl-slot" type="number" min="10" max="240" value="30" class="phone-input" style="${FIELD}">`)}
          </div>

          <p id="sl-cal-help" style="font-size:0.75rem;color:#fcd34d;margin:0.6rem 0 0;line-height:1.5;"></p>

          <div style="margin-top:0.9rem;">
            <label style="${LABEL}">OPENING HOURS (24h, leave both empty = closed)</label>
            ${hoursRows}
          </div>

          <div style="margin-top:0.9rem;">
            <label style="${LABEL}">SERVICES - one per line:  Category | Name | Price | Minutes | Description | tags</label>
            <textarea id="sl-services" class="phone-input" rows="9" style="${FIELD}font-family:monospace;font-size:0.78rem;"></textarea>
          </div>

          <button class="btn btn-primary" onclick="salonSave()" style="width:auto;margin-top:0.9rem;"><i class="fas fa-save"></i> Save parlour</button>
          <p id="sl-save-msg" style="font-size:0.8rem;margin-top:0.5rem;white-space:pre-wrap;"></p>
        </div>

        <div class="glass-panel" style="padding:1.5rem;margin-bottom:1rem;border-color:rgba(37,211,102,0.4);">
          <h3 style="font-size:1.15rem;margin-bottom:0.25rem;"><i class="fab fa-whatsapp" style="color:#34d399;"></i> WhatsApp number</h3>
          <div id="sl-wa-status" style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.7rem;"></div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.7rem;">
            ${field('PHONE NUMBER ID', `<input id="sl-pid" class="phone-input" style="${FIELD}">`)}
            ${field('WHATSAPP BUSINESS ACCOUNT ID', `<input id="sl-waba" class="phone-input" style="${FIELD}">`)}
            ${field('DISPLAY PHONE (optional)', `<input id="sl-disp" class="phone-input" placeholder="+91 98765 43210" style="${FIELD}">`)}
            ${field('ACCESS TOKEN (permanent System User token)', `<input id="sl-token" type="password" autocomplete="off" class="phone-input" style="${FIELD}">`)}
          </div>

          <p style="font-size:0.74rem;color:var(--text-secondary);margin-top:0.6rem;">
            Meta &rarr; WhatsApp &rarr; API Setup. Use a number that is <strong>not</strong> used by your sales store. The token is stored encrypted.
          </p>

          <button class="btn btn-primary" onclick="salonConnect()" style="width:auto;margin-top:0.5rem;"><i class="fas fa-plug"></i> Connect number</button>
          <button class="btn btn-secondary" onclick="salonHealth()" style="width:auto;margin-top:0.5rem;"><i class="fas fa-stethoscope"></i> Check connection</button>
          <pre id="sl-wa-msg" style="font-size:0.76rem;white-space:pre-wrap;margin-top:0.6rem;color:#cbd5e1;"></pre>
        </div>

        <div class="glass-panel" style="padding:1.5rem;margin-bottom:1rem;border-color:rgba(236,72,153,0.4);">
          <h3 style="font-size:1.15rem;margin-bottom:0.25rem;"><i class="fas fa-calendar-plus" style="color:#f472b6;"></i> Book an appointment</h3>
          <p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:0.8rem;">
            Customers book themselves on WhatsApp (they send "Hi" and choose <strong>Book appointment</strong>). Use this form for phone calls and walk-ins. It uses the same free-time rules, so nobody is double-booked.
          </p>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.7rem;">
            ${field('SERVICE', `<select id="sl-bk-service" class="phone-input" style="${FIELD}"></select>`)}
            ${field('DATE', `<input id="sl-bk-day" type="date" class="phone-input" style="${FIELD}">`)}
          </div>

          <button class="btn btn-secondary" onclick="salonFindSlots()" style="width:auto;margin-top:0.6rem;"><i class="fas fa-clock"></i> Show free times</button>

          <div id="sl-bk-slots" style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:0.6rem;"></div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.7rem;margin-top:0.7rem;">
            ${field('CUSTOMER NAME', `<input id="sl-bk-name" class="phone-input" style="${FIELD}">`)}
            ${field('CUSTOMER PHONE (with country code)', `<input id="sl-bk-phone" class="phone-input" placeholder="919876543210" style="${FIELD}">`)}
          </div>

          <label style="font-size:0.78rem;color:var(--text-secondary);display:flex;align-items:center;gap:0.4rem;margin-top:0.6rem;">
            <input type="checkbox" id="sl-bk-notify" checked> Send the confirmation on WhatsApp
          </label>

          <button class="btn btn-primary" onclick="salonBook()" style="width:auto;margin-top:0.6rem;"><i class="fas fa-check"></i> Book now</button>
          <p id="sl-bk-msg" style="font-size:0.8rem;margin-top:0.5rem;white-space:pre-wrap;"></p>
        </div>

        <div class="glass-panel" style="padding:1.5rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.6rem;margin-bottom:0.7rem;">
            <h3 style="font-size:1.15rem;"><i class="fas fa-calendar-check" style="color:#60a5fa;"></i> Appointments</h3>
            <div style="display:flex;gap:0.4rem;">
              <button class="btn btn-secondary" id="sl-btn-upcoming" onclick="salonLoadBookings('upcoming')" style="width:auto;padding:0.35rem 0.8rem;font-size:0.78rem;">Upcoming</button>
              <button class="btn btn-secondary" id="sl-btn-past" onclick="salonLoadBookings('past')" style="width:auto;padding:0.35rem 0.8rem;font-size:0.78rem;">Past</button>
            </div>
          </div>

          <div class="crm-table-container">
            <table>
              <thead><tr><th>#</th><th>Customer</th><th>Service</th><th>When</th><th>Status</th><th></th></tr></thead>
              <tbody id="sl-bookings"><tr><td colspan="6" style="text-align:center;color:#888;">Loading...</td></tr></tbody>
            </table>
          </div>

          <div style="margin-top:1rem;border-top:1px solid var(--border-color);padding-top:0.9rem;">
            <label style="${LABEL}">CLOSED DAYS (holidays)</label>
            <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;margin-top:0.3rem;">
              <input id="sl-holiday" type="date" class="phone-input" style="width:180px;${FIELD}">
              <button class="btn btn-secondary" onclick="salonAddHoliday()" style="width:auto;padding:0.4rem 0.8rem;font-size:0.78rem;">Mark closed</button>
            </div>
            <div id="sl-holidays" style="margin-top:0.5rem;display:flex;gap:0.4rem;flex-wrap:wrap;"></div>
            <p id="sl-book-msg" style="font-size:0.78rem;margin-top:0.4rem;"></p>
          </div>
        </div>
      </div>`;

    return true;
  }

  /* ---------------- fill / read the form ---------------- */

  const SAMPLE_SERVICES = [
    'Hair | Haircut (Women) | 400 | 45 | Wash, cut and blow-dry | hair cut style',
    'Hair | Hair Spa | 900 | 60 | Deep conditioning spa | hair spa relax',
    'Skin | Fruit Facial | 700 | 60 | Glow facial for all skin types | facial skin glow',
    'Skin | D-Tan Cleanup | 500 | 40 | Removes tan and dullness | skin detan cleanup glow',
    'Waxing | Full Arms Wax | 300 | 30 | Rica wax | wax removal',
    'Hands & Feet | Manicure + Pedicure | 800 | 75 | Spa manicure and pedicure | nail manicure pedicure hands',
    'Bridal | Bridal Makeup | 12000 | 120 | HD bridal makeup with hairstyle | bridal makeup wedding party'
  ].join('\n');

  function fillForm(state) {
    const s = state.exists ? state.store : {};

    $('sl-name').value = s.name || '';
    $('sl-owner').value = s.owner_phone || '';
    $('sl-cal').value = s.calendar_id || '';
    $('sl-address').value = s.address || '';
    $('sl-cap').value = s.capacity || 1;
    $('sl-slot').value = s.slot_minutes || 30;

    for (let d = 0; d < 7; d++) {
      const h = state.exists ? (state.hours || {})[d] : d === 0 ? null : ['10:00', '20:00'];
      $('sl-o' + d).value = h ? h[0] : '';
      $('sl-c' + d).value = h ? h[1] : '';
    }

    $('sl-services').value = state.exists
      ? (state.services || [])
          .map(x => [x.category, x.name, x.price, x.duration_min, x.description || '', x.tags || ''].join(' | '))
          .join('\n')
      : SAMPLE_SERVICES;

    const help = $('sl-cal-help');

    if (help) {
      help.innerHTML = serviceAccount
        ? `📅 To see bookings on your phone: open Google Calendar &rarr; your calendar &rarr; <em>Settings and sharing</em> &rarr; <em>Share with specific people</em> &rarr; add <strong>${esc(serviceAccount)}</strong> with <em>Make changes to events</em>. Then paste your Calendar ID above (for a personal calendar it is your Gmail address).`
        : '📅 Google Calendar is not configured on the server yet (GOOGLE_SERVICE_ACCOUNT_JSON). Bookings still work; they just will not appear in a calendar.';
    }

    const wa = state.whatsapp || { connected: false };

    $('sl-wa-status').innerHTML = wa.connected
      ? `✅ Connected: <strong>${esc(wa.display_phone || wa.phone_number_id)}</strong> (phone number id ${esc(wa.phone_number_id)})`
      : '⚪ Not connected yet. Save the parlour first, then connect a number.';

    $('sl-pid').value = wa.connected ? wa.phone_number_id : '';
    $('sl-token').value = '';

    renderHolidays(state.holidays || []);

    services = state.services || [];

    const pick = $('sl-bk-service');

    if (pick) {
      pick.innerHTML = services.length
        ? services.map(s => `<option value="${esc(s.id)}">${esc(s.name)} - ₹${esc(s.price)} (${esc(s.duration_min)} min)</option>`).join('')
        : '<option value="">Save the parlour with services first</option>';
    }

    const day = $('sl-bk-day');
    if (day && !day.value) day.value = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    const slots = $('sl-bk-slots');
    if (slots) slots.innerHTML = '';
    chosenTime = '';
  }

  let chosenTime = '';

  async function findSlots() {
    const box = $('sl-bk-slots');
    chosenTime = '';
    box.innerHTML = '';

    try {
      const data = await api(`/slots?service_id=${encodeURIComponent(val('sl-bk-service'))}&day=${encodeURIComponent(val('sl-bk-day'))}`);

      if (!data.slots.length) {
        say('sl-bk-msg', 'No free times on that day. Try another date.', false);
        return;
      }

      say('sl-bk-msg', 'Tap a time:', true);

      box.innerHTML = data.slots
        .map(s => `<button type="button" class="btn btn-secondary sl-slot" data-time="${esc(s.time)}" onclick="salonPickTime('${esc(s.time)}')" style="width:auto;padding:4px 10px;font-size:0.78rem;">${esc(s.label)}</button>`)
        .join('');
    } catch (error) {
      say('sl-bk-msg', error.message, false);
    }
  }

  function pickTime(time) {
    chosenTime = time;

    document.querySelectorAll('.sl-slot').forEach(btn => {
      const on = btn.dataset.time === time;
      btn.style.background = on ? '#ec4899' : '';
      btn.style.color = on ? '#fff' : '';
    });
  }

  async function book() {
    try {
      if (!chosenTime) throw new Error('Press "Show free times" and tap a time first');

      const out = await api('/book', 'POST', {
        service_id: Number(val('sl-bk-service')),
        day: val('sl-bk-day'),
        time: chosenTime,
        name: val('sl-bk-name'),
        phone: val('sl-bk-phone'),
        notify: $('sl-bk-notify').checked
      });

      say(
        'sl-bk-msg',
        `Booked ✅ #${out.appointment.id}` +
          (out.calendar ? '\nAdded to the Google Calendar.' : '') +
          ($('sl-bk-notify').checked
            ? out.notified
              ? '\nConfirmation sent on WhatsApp.'
              : '\nWhatsApp confirmation NOT sent: WhatsApp only allows free messages within 24 hours after the customer last wrote to you. Tell the customer yourself.'
            : ''),
        true
      );

      $('sl-bk-name').value = '';
      $('sl-bk-phone').value = '';
      $('sl-bk-slots').innerHTML = '';
      chosenTime = '';

      loadBookings('upcoming');
    } catch (error) {
      say('sl-bk-msg', error.message, false);
    }
  }

  function parseServices() {
    return val('sl-services')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map((line, i) => {
        const p = line.split('|').map(x => x.trim());

        if (p.length < 3 || !p[1] || Number.isNaN(Number(p[2]))) {
          throw new Error(`Line ${i + 1}: needs at least  Category | Name | Price`);
        }

        return {
          category: p[0] || 'General',
          name: p[1],
          price: Number(p[2]),
          duration_min: Number(p[3]) || 30,
          description: p[4] || '',
          tags: p[5] || ''
        };
      });
  }

  /* ---------------- actions ---------------- */

  async function loadStore() {
    const state = await api('/state');

    serviceAccount = state.service_account_email || serviceAccount;

    fillForm(state);
    await loadBookings(bookingsWhen);
  }

  async function save() {
    try {
      const hours = {};

      for (let d = 0; d < 7; d++) {
        const o = val('sl-o' + d);
        const c = val('sl-c' + d);
        hours[d] = o && c ? [o, c] : null;
      }

      await api('/save', 'POST', {
        name: val('sl-name'),
        owner_phone: val('sl-owner'),
        calendar_id: val('sl-cal'),
        address: val('sl-address'),
        capacity: Number(val('sl-cap')) || 1,
        slot_minutes: Number(val('sl-slot')) || 30,
        hours,
        services: parseServices()
      });

      say('sl-save-msg', 'Saved ✅ The WhatsApp bot now uses these details.', true);
      await loadStore();
    } catch (error) {
      say('sl-save-msg', error.message, false);
    }
  }

  async function connect() {
    try {
      const out = await api('/connect', 'POST', {
        phone_number_id: val('sl-pid'),
        waba_id: val('sl-waba'),
        display_phone: val('sl-disp'),
        access_token: val('sl-token')
      });

      $('sl-wa-msg').style.color = '#34d399';
      $('sl-wa-msg').textContent = `Connected ✅ ${out.display_phone || ''} ${out.verified_name ? '(' + out.verified_name + ')' : ''}\nNow press "Check connection", then send "Hi" to the number from your phone.`;

      $('sl-token').value = '';
      await loadStore();
    } catch (error) {
      $('sl-wa-msg').style.color = '#f87171';
      $('sl-wa-msg').textContent = error.message;
    }
  }

  async function health() {
    try {
      const out = await api('/health');

      $('sl-wa-msg').style.color = out.all_ok ? '#34d399' : '#f87171';
      $('sl-wa-msg').textContent =
        (out.all_ok ? 'ALL GOOD ✅\n' : 'PROBLEM ❌\n') +
        out.checks.map(c => `${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ' - ' + c.detail : ''}`).join('\n');
    } catch (error) {
      $('sl-wa-msg').style.color = '#f87171';
      $('sl-wa-msg').textContent = error.message;
    }
  }

  function when(value) {
    return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  }

  async function loadBookings(which) {
    bookingsWhen = which === 'past' ? 'past' : 'upcoming';

    const body = $('sl-bookings');
    if (!body) return;

    try {
      const data = await api(`/appointments?when=${bookingsWhen}`);
      const rows = data.appointments || [];

      body.innerHTML = rows.length
        ? rows
            .map(
              a => `
          <tr>
            <td>${esc(a.id)}</td>
            <td><div style="font-weight:600;color:#fff;">${esc(a.customer_name)}</div><div style="font-size:0.72rem;color:#64748b;">+${esc(a.customer_phone)}</div></td>
            <td>${esc(a.service)}</td>
            <td>${esc(when(a.start_at))}</td>
            <td>${esc(a.status)}</td>
            <td>${a.status === 'confirmed' && bookingsWhen === 'upcoming' ? `<button class="btn btn-secondary" onclick="salonCancel(${Number(a.id)})" style="width:auto;padding:2px 8px;font-size:0.72rem;border-color:#ef4444;color:#f87171;">Cancel</button>` : ''}</td>
          </tr>`
            )
            .join('')
        : `<tr><td colspan="6" style="text-align:center;color:#888;">No ${bookingsWhen} appointments.</td></tr>`;
    } catch (error) {
      body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#f87171;">${esc(error.message)}</td></tr>`;
    }
  }

  async function cancel(id) {
    if (!confirm(`Cancel booking #${id}? The customer is told on WhatsApp and it is removed from the calendar.`)) return;

    try {
      await api(`/appointments/${encodeURIComponent(id)}/cancel`, 'POST', {});
      say('sl-book-msg', `Booking #${id} cancelled ✅`, true);
    } catch (error) {
      say('sl-book-msg', error.message, false);
    }

    loadBookings(bookingsWhen);
  }

  function renderHolidays(days) {
    const box = $('sl-holidays');
    if (!box) return;

    box.innerHTML = days.length
      ? days
          .map(
            d => `<span style="background:rgba(255,255,255,0.06);border:1px solid var(--border-color);border-radius:999px;padding:3px 10px;font-size:0.75rem;">
                    ${esc(d)} <a href="#" onclick="salonRemoveHoliday('${esc(d)}');return false;" style="color:#f87171;text-decoration:none;margin-left:4px;">✕</a></span>`
          )
          .join('')
      : '<span style="font-size:0.75rem;color:var(--text-secondary);">No upcoming closed days.</span>';
  }

  async function addHoliday() {
    try {
      await api('/holiday', 'POST', { day: val('sl-holiday') });
      say('sl-book-msg', 'Marked closed ✅', true);
      await loadStore();
    } catch (error) {
      say('sl-book-msg', error.message, false);
    }
  }

  async function removeHoliday(day) {
    try {
      await api(`/holiday/${encodeURIComponent(day)}`, 'DELETE');
      await loadStore();
    } catch (error) {
      say('sl-book-msg', error.message, false);
    }
  }

  async function pickStore() {
    storeId = $('sl-store-pick')?.value || '';

    const body = $('sl-body');
    if (body) body.style.display = storeId ? '' : 'none';

    const link = $('sl-open-owner');

    if (link) {
      link.style.display = storeId ? '' : 'none';
      link.href = `/salon?store_id=${encodeURIComponent(storeId)}`;
    }

    if (storeId) {
      try {
        await loadStore();
      } catch (error) {
        say('sl-save-msg', error.message, false);
      }
    }
  }

  /* ---------------- start ---------------- */

  function showTab(only) {
    $('salon-tab-btn').style.display = '';

    if (only) {
      // A parlour owner has no use for the clothing / electronics tabs
      document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.id !== 'salon-tab-btn') btn.style.display = 'none';
      });

      $('salon-tab-btn').click();
    }
  }

  async function start() {
    if (started) return;
    started = true;

    if (!$('tab-salon') || !$('salon-tab-btn')) return;

    let state;

    try {
      state = await api('/state');
    } catch (error) {
      console.warn('[Parlour] not available:', error.message);
      return;
    }

    if (!state.enabled) return;

    isAdmin = Boolean(state.is_admin);
    serviceAccount = state.service_account_email || null;

    if (isAdmin) {
      if (!buildScreen()) return;

      try {
        const res = await fetch('/api/catalog/stores', { credentials: 'same-origin', cache: 'no-store' });
        const data = await res.json();

        const list = (data.stores || []).map(s => ({ id: s.id, label: `${s.business_name || s.name || s.id} (${s.id})` }));

        // Parlours created earlier from salon-admin.html use their own ids: list them too
        try {
          const extra = await api('/stores');

          (extra.stores || []).forEach(s => {
            if (!list.some(x => String(x.id) === String(s.store_id))) {
              list.push({ id: s.store_id, label: `💅 ${s.name} (${s.store_id})` });
            }
          });
        } catch (error) {
          console.warn('[Parlour] could not list parlours', error.message);
        }

        $('sl-store-pick').innerHTML =
          '<option value="">- choose a business -</option>' +
          list.map(s => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('');
      } catch (error) {
        console.warn('[Parlour] could not list stores', error.message);
      }

      $('sl-body').style.display = 'none';
      showTab(false);
      return;
    }

    // Business owner: only when a parlour was set up for them
    if (!state.exists) return;

    if (!buildScreen()) return;

    showTab(true);
    fillForm(state);
    loadBookings('upcoming');
  }

  Object.assign(window, {
    salonSave: save,
    salonConnect: connect,
    salonHealth: health,
    salonLoadBookings: loadBookings,
    salonCancel: cancel,
    salonAddHoliday: addHoliday,
    salonRemoveHoliday: removeHoliday,
    salonPickStore: pickStore,
    salonFindSlots: findSlots,
    salonPickTime: pickTime,
    salonBook: book
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  // Re-check every few minutes so a booking made on WhatsApp appears without a refresh
  setInterval(() => {
    const tab = $('tab-salon');
    if (started && tab && tab.offsetParent !== null && $('sl-bookings')) loadBookings(bookingsWhen);
  }, 30000);
})();




// /* ============================================================
//  * BEAUTY PARLOUR TAB  (appointment booking bot)
//  *
//  * - Admin: sees the tab always and picks which business to set up.
//  * - Business owner: sees the tab only when a parlour was set up for their store.
//  *   (Parlour owners then see only this tab.)
//  * Everything is drawn into <section id="tab-salon"> by this file.
//  * ============================================================ */

// (function () {
//   const API = '/api/salon-app';
//   const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

//   let isAdmin = false;
//   let storeId = '';
//   let serviceAccount = null;
//   let bookingsWhen = 'upcoming';
//   let started = false;
//   let services = [];

//   const $ = id => document.getElementById(id);

//   function esc(value) {
//     return String(value ?? '')
//       .replace(/&/g, '&amp;')
//       .replace(/</g, '&lt;')
//       .replace(/>/g, '&gt;')
//       .replace(/"/g, '&quot;')
//       .replace(/'/g, '&#039;');
//   }

//   const val = id => ($(id)?.value || '').trim();

//   function say(id, text, ok) {
//     const el = $(id);
//     if (!el) return;
//     el.style.color = ok ? '#34d399' : '#f87171';
//     el.textContent = text || '';
//   }

//   async function api(path, method = 'GET', body) {
//     const sep = path.includes('?') ? '&' : '?';
//     const url = API + path + (isAdmin && storeId ? `${sep}store_id=${encodeURIComponent(storeId)}` : '');

//     const res = await fetch(url, {
//       method,
//       credentials: 'same-origin',
//       cache: 'no-store',
//       headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
//       body: body ? JSON.stringify({ ...body, ...(isAdmin && storeId ? { store_id: storeId } : {}) }) : undefined
//     });

//     let data = null;

//     try {
//       data = await res.json();
//     } catch {
//       throw new Error(`Server did not return JSON (HTTP ${res.status}). Restart the server or log in again.`);
//     }

//     if (!res.ok || data.success === false) throw new Error(data.message || data.error || `HTTP ${res.status}`);

//     return data;
//   }

//   /* ---------------- screen ---------------- */

//   const FIELD = 'border: 1px solid var(--border-color);';
//   const LABEL = 'font-size: 0.72rem; color: var(--text-muted); font-weight: 700;';

//   function field(label, inner) {
//     return `<div><label style="${LABEL}">${label}</label>${inner}</div>`;
//   }

//   function buildScreen() {
//     const section = $('tab-salon');
//     if (!section) return false;

//     const hoursRows = [1, 2, 3, 4, 5, 6, 0]
//       .map(
//         d => `
//         <div style="display:grid;grid-template-columns:90px 1fr 1fr;gap:0.5rem;align-items:center;margin-top:0.35rem;">
//           <span style="font-size:0.8rem;color:var(--text-secondary);">${DAY_NAMES[d]}</span>
//           <input id="sl-o${d}" class="phone-input" placeholder="open  e.g. 10:00" style="${FIELD}">
//           <input id="sl-c${d}" class="phone-input" placeholder="close e.g. 20:00" style="${FIELD}">
//         </div>`
//       )
//       .join('');

//     section.innerHTML = `
//       ${
//         isAdmin
//           ? `<div class="glass-panel" style="padding:1rem 1.25rem;margin-bottom:1rem;display:flex;gap:0.6rem;align-items:center;flex-wrap:wrap;">
//                <strong style="font-size:0.85rem;">Business:</strong>
//                <select id="sl-store-pick" class="phone-input" style="width:260px;${FIELD}" onchange="salonPickStore()"></select>
//                <span style="font-size:0.75rem;color:var(--text-secondary);">The business must have signed up first (it gets its own login).</span>
//              </div>`
//           : ''
//       }

//       <div id="sl-body">
//         <div class="glass-panel" style="padding:1.5rem;margin-bottom:1rem;">
//           <h3 style="font-size:1.15rem;margin-bottom:0.25rem;"><i class="fas fa-spa" style="color:#f472b6;"></i> Parlour details</h3>
//           <p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:0.9rem;">The WhatsApp bot answers questions, recommends services and books appointments from this information.</p>

//           <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.7rem;">
//             ${field('PARLOUR NAME *', `<input id="sl-name" class="phone-input" placeholder="Glow Beauty Parlour" style="${FIELD}">`)}
//             ${field('OWNER WHATSAPP (country code, digits)', `<input id="sl-owner" class="phone-input" placeholder="919876543210" style="${FIELD}">`)}
//             ${field('GOOGLE CALENDAR ID', `<input id="sl-cal" class="phone-input" placeholder="your@gmail.com or xxx@group.calendar.google.com" style="${FIELD}">`)}
//             ${field('ADDRESS', `<input id="sl-address" class="phone-input" placeholder="Shop 4, Main Road, Hyderabad" style="${FIELD}">`)}
//             ${field('CHAIRS / STAFF AT THE SAME TIME', `<input id="sl-cap" type="number" min="1" max="50" value="1" class="phone-input" style="${FIELD}">`)}
//             ${field('SLOT EVERY (minutes)', `<input id="sl-slot" type="number" min="10" max="240" value="30" class="phone-input" style="${FIELD}">`)}
//           </div>

//           <p id="sl-cal-help" style="font-size:0.75rem;color:#fcd34d;margin:0.6rem 0 0;line-height:1.5;"></p>

//           <div style="margin-top:0.9rem;">
//             <label style="${LABEL}">OPENING HOURS (24h, leave both empty = closed)</label>
//             ${hoursRows}
//           </div>

//           <div style="margin-top:0.9rem;">
//             <label style="${LABEL}">SERVICES - one per line:  Category | Name | Price | Minutes | Description | tags</label>
//             <textarea id="sl-services" class="phone-input" rows="9" style="${FIELD}font-family:monospace;font-size:0.78rem;"></textarea>
//           </div>

//           <button class="btn btn-primary" onclick="salonSave()" style="width:auto;margin-top:0.9rem;"><i class="fas fa-save"></i> Save parlour</button>
//           <p id="sl-save-msg" style="font-size:0.8rem;margin-top:0.5rem;white-space:pre-wrap;"></p>
//         </div>

//         <div class="glass-panel" style="padding:1.5rem;margin-bottom:1rem;border-color:rgba(37,211,102,0.4);">
//           <h3 style="font-size:1.15rem;margin-bottom:0.25rem;"><i class="fab fa-whatsapp" style="color:#34d399;"></i> WhatsApp number</h3>
//           <div id="sl-wa-status" style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.7rem;"></div>

//           <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.7rem;">
//             ${field('PHONE NUMBER ID', `<input id="sl-pid" class="phone-input" style="${FIELD}">`)}
//             ${field('WHATSAPP BUSINESS ACCOUNT ID', `<input id="sl-waba" class="phone-input" style="${FIELD}">`)}
//             ${field('DISPLAY PHONE (optional)', `<input id="sl-disp" class="phone-input" placeholder="+91 98765 43210" style="${FIELD}">`)}
//             ${field('ACCESS TOKEN (permanent System User token)', `<input id="sl-token" type="password" autocomplete="off" class="phone-input" style="${FIELD}">`)}
//           </div>

//           <p style="font-size:0.74rem;color:var(--text-secondary);margin-top:0.6rem;">
//             Meta &rarr; WhatsApp &rarr; API Setup. Use a number that is <strong>not</strong> used by your sales store. The token is stored encrypted.
//           </p>

//           <button class="btn btn-primary" onclick="salonConnect()" style="width:auto;margin-top:0.5rem;"><i class="fas fa-plug"></i> Connect number</button>
//           <button class="btn btn-secondary" onclick="salonHealth()" style="width:auto;margin-top:0.5rem;"><i class="fas fa-stethoscope"></i> Check connection</button>
//           <pre id="sl-wa-msg" style="font-size:0.76rem;white-space:pre-wrap;margin-top:0.6rem;color:#cbd5e1;"></pre>
//         </div>

//         <div class="glass-panel" style="padding:1.5rem;margin-bottom:1rem;border-color:rgba(236,72,153,0.4);">
//           <h3 style="font-size:1.15rem;margin-bottom:0.25rem;"><i class="fas fa-calendar-plus" style="color:#f472b6;"></i> Book an appointment</h3>
//           <p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:0.8rem;">
//             Customers book themselves on WhatsApp (they send "Hi" and choose <strong>Book appointment</strong>). Use this form for phone calls and walk-ins. It uses the same free-time rules, so nobody is double-booked.
//           </p>

//           <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.7rem;">
//             ${field('SERVICE', `<select id="sl-bk-service" class="phone-input" style="${FIELD}"></select>`)}
//             ${field('DATE', `<input id="sl-bk-day" type="date" class="phone-input" style="${FIELD}">`)}
//           </div>

//           <button class="btn btn-secondary" onclick="salonFindSlots()" style="width:auto;margin-top:0.6rem;"><i class="fas fa-clock"></i> Show free times</button>

//           <div id="sl-bk-slots" style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:0.6rem;"></div>

//           <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.7rem;margin-top:0.7rem;">
//             ${field('CUSTOMER NAME', `<input id="sl-bk-name" class="phone-input" style="${FIELD}">`)}
//             ${field('CUSTOMER PHONE (with country code)', `<input id="sl-bk-phone" class="phone-input" placeholder="919876543210" style="${FIELD}">`)}
//           </div>

//           <label style="font-size:0.78rem;color:var(--text-secondary);display:flex;align-items:center;gap:0.4rem;margin-top:0.6rem;">
//             <input type="checkbox" id="sl-bk-notify" checked> Send the confirmation on WhatsApp
//           </label>

//           <button class="btn btn-primary" onclick="salonBook()" style="width:auto;margin-top:0.6rem;"><i class="fas fa-check"></i> Book now</button>
//           <p id="sl-bk-msg" style="font-size:0.8rem;margin-top:0.5rem;white-space:pre-wrap;"></p>
//         </div>

//         <div class="glass-panel" style="padding:1.5rem;">
//           <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.6rem;margin-bottom:0.7rem;">
//             <h3 style="font-size:1.15rem;"><i class="fas fa-calendar-check" style="color:#60a5fa;"></i> Appointments</h3>
//             <div style="display:flex;gap:0.4rem;">
//               <button class="btn btn-secondary" id="sl-btn-upcoming" onclick="salonLoadBookings('upcoming')" style="width:auto;padding:0.35rem 0.8rem;font-size:0.78rem;">Upcoming</button>
//               <button class="btn btn-secondary" id="sl-btn-past" onclick="salonLoadBookings('past')" style="width:auto;padding:0.35rem 0.8rem;font-size:0.78rem;">Past</button>
//             </div>
//           </div>

//           <div class="crm-table-container">
//             <table>
//               <thead><tr><th>#</th><th>Customer</th><th>Service</th><th>When</th><th>Status</th><th></th></tr></thead>
//               <tbody id="sl-bookings"><tr><td colspan="6" style="text-align:center;color:#888;">Loading...</td></tr></tbody>
//             </table>
//           </div>

//           <div style="margin-top:1rem;border-top:1px solid var(--border-color);padding-top:0.9rem;">
//             <label style="${LABEL}">CLOSED DAYS (holidays)</label>
//             <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;margin-top:0.3rem;">
//               <input id="sl-holiday" type="date" class="phone-input" style="width:180px;${FIELD}">
//               <button class="btn btn-secondary" onclick="salonAddHoliday()" style="width:auto;padding:0.4rem 0.8rem;font-size:0.78rem;">Mark closed</button>
//             </div>
//             <div id="sl-holidays" style="margin-top:0.5rem;display:flex;gap:0.4rem;flex-wrap:wrap;"></div>
//             <p id="sl-book-msg" style="font-size:0.78rem;margin-top:0.4rem;"></p>
//           </div>
//         </div>
//       </div>`;

//     return true;
//   }

//   /* ---------------- fill / read the form ---------------- */

//   const SAMPLE_SERVICES = [
//     'Hair | Haircut (Women) | 400 | 45 | Wash, cut and blow-dry | hair cut style',
//     'Hair | Hair Spa | 900 | 60 | Deep conditioning spa | hair spa relax',
//     'Skin | Fruit Facial | 700 | 60 | Glow facial for all skin types | facial skin glow',
//     'Skin | D-Tan Cleanup | 500 | 40 | Removes tan and dullness | skin detan cleanup glow',
//     'Waxing | Full Arms Wax | 300 | 30 | Rica wax | wax removal',
//     'Hands & Feet | Manicure + Pedicure | 800 | 75 | Spa manicure and pedicure | nail manicure pedicure hands',
//     'Bridal | Bridal Makeup | 12000 | 120 | HD bridal makeup with hairstyle | bridal makeup wedding party'
//   ].join('\n');

//   function fillForm(state) {
//     const s = state.exists ? state.store : {};

//     $('sl-name').value = s.name || '';
//     $('sl-owner').value = s.owner_phone || '';
//     $('sl-cal').value = s.calendar_id || '';
//     $('sl-address').value = s.address || '';
//     $('sl-cap').value = s.capacity || 1;
//     $('sl-slot').value = s.slot_minutes || 30;

//     for (let d = 0; d < 7; d++) {
//       const h = state.exists ? (state.hours || {})[d] : d === 0 ? null : ['10:00', '20:00'];
//       $('sl-o' + d).value = h ? h[0] : '';
//       $('sl-c' + d).value = h ? h[1] : '';
//     }

//     $('sl-services').value = state.exists
//       ? (state.services || [])
//           .map(x => [x.category, x.name, x.price, x.duration_min, x.description || '', x.tags || ''].join(' | '))
//           .join('\n')
//       : SAMPLE_SERVICES;

//     const help = $('sl-cal-help');

//     if (help) {
//       help.innerHTML = serviceAccount
//         ? `📅 To see bookings on your phone: open Google Calendar &rarr; your calendar &rarr; <em>Settings and sharing</em> &rarr; <em>Share with specific people</em> &rarr; add <strong>${esc(serviceAccount)}</strong> with <em>Make changes to events</em>. Then paste your Calendar ID above (for a personal calendar it is your Gmail address).`
//         : '📅 Google Calendar is not configured on the server yet (GOOGLE_SERVICE_ACCOUNT_JSON). Bookings still work; they just will not appear in a calendar.';
//     }

//     const wa = state.whatsapp || { connected: false };

//     $('sl-wa-status').innerHTML = wa.connected
//       ? `✅ Connected: <strong>${esc(wa.display_phone || wa.phone_number_id)}</strong> (phone number id ${esc(wa.phone_number_id)})`
//       : '⚪ Not connected yet. Save the parlour first, then connect a number.';

//     $('sl-pid').value = wa.connected ? wa.phone_number_id : '';
//     $('sl-token').value = '';

//     renderHolidays(state.holidays || []);

//     services = state.services || [];

//     const pick = $('sl-bk-service');

//     if (pick) {
//       pick.innerHTML = services.length
//         ? services.map(s => `<option value="${esc(s.id)}">${esc(s.name)} - ₹${esc(s.price)} (${esc(s.duration_min)} min)</option>`).join('')
//         : '<option value="">Save the parlour with services first</option>';
//     }

//     const day = $('sl-bk-day');
//     if (day && !day.value) day.value = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

//     const slots = $('sl-bk-slots');
//     if (slots) slots.innerHTML = '';
//     chosenTime = '';
//   }

//   let chosenTime = '';

//   async function findSlots() {
//     const box = $('sl-bk-slots');
//     chosenTime = '';
//     box.innerHTML = '';

//     try {
//       const data = await api(`/slots?service_id=${encodeURIComponent(val('sl-bk-service'))}&day=${encodeURIComponent(val('sl-bk-day'))}`);

//       if (!data.slots.length) {
//         say('sl-bk-msg', 'No free times on that day. Try another date.', false);
//         return;
//       }

//       say('sl-bk-msg', 'Tap a time:', true);

//       box.innerHTML = data.slots
//         .map(s => `<button type="button" class="btn btn-secondary sl-slot" data-time="${esc(s.time)}" onclick="salonPickTime('${esc(s.time)}')" style="width:auto;padding:4px 10px;font-size:0.78rem;">${esc(s.label)}</button>`)
//         .join('');
//     } catch (error) {
//       say('sl-bk-msg', error.message, false);
//     }
//   }

//   function pickTime(time) {
//     chosenTime = time;

//     document.querySelectorAll('.sl-slot').forEach(btn => {
//       const on = btn.dataset.time === time;
//       btn.style.background = on ? '#ec4899' : '';
//       btn.style.color = on ? '#fff' : '';
//     });
//   }

//   async function book() {
//     try {
//       if (!chosenTime) throw new Error('Press "Show free times" and tap a time first');

//       const out = await api('/book', 'POST', {
//         service_id: Number(val('sl-bk-service')),
//         day: val('sl-bk-day'),
//         time: chosenTime,
//         name: val('sl-bk-name'),
//         phone: val('sl-bk-phone'),
//         notify: $('sl-bk-notify').checked
//       });

//       say(
//         'sl-bk-msg',
//         `Booked ✅ #${out.appointment.id}` +
//           (out.calendar ? '\nAdded to the Google Calendar.' : '') +
//           ($('sl-bk-notify').checked
//             ? out.notified
//               ? '\nConfirmation sent on WhatsApp.'
//               : '\nWhatsApp confirmation NOT sent: WhatsApp only allows free messages within 24 hours after the customer last wrote to you. Tell the customer yourself.'
//             : ''),
//         true
//       );

//       $('sl-bk-name').value = '';
//       $('sl-bk-phone').value = '';
//       $('sl-bk-slots').innerHTML = '';
//       chosenTime = '';

//       loadBookings('upcoming');
//     } catch (error) {
//       say('sl-bk-msg', error.message, false);
//     }
//   }

//   function parseServices() {
//     return val('sl-services')
//       .split('\n')
//       .map(line => line.trim())
//       .filter(Boolean)
//       .map((line, i) => {
//         const p = line.split('|').map(x => x.trim());

//         if (p.length < 3 || !p[1] || Number.isNaN(Number(p[2]))) {
//           throw new Error(`Line ${i + 1}: needs at least  Category | Name | Price`);
//         }

//         return {
//           category: p[0] || 'General',
//           name: p[1],
//           price: Number(p[2]),
//           duration_min: Number(p[3]) || 30,
//           description: p[4] || '',
//           tags: p[5] || ''
//         };
//       });
//   }

//   /* ---------------- actions ---------------- */

//   async function loadStore() {
//     const state = await api('/state');

//     serviceAccount = state.service_account_email || serviceAccount;

//     fillForm(state);
//     await loadBookings(bookingsWhen);
//   }

//   async function save() {
//     try {
//       const hours = {};

//       for (let d = 0; d < 7; d++) {
//         const o = val('sl-o' + d);
//         const c = val('sl-c' + d);
//         hours[d] = o && c ? [o, c] : null;
//       }

//       await api('/save', 'POST', {
//         name: val('sl-name'),
//         owner_phone: val('sl-owner'),
//         calendar_id: val('sl-cal'),
//         address: val('sl-address'),
//         capacity: Number(val('sl-cap')) || 1,
//         slot_minutes: Number(val('sl-slot')) || 30,
//         hours,
//         services: parseServices()
//       });

//       say('sl-save-msg', 'Saved ✅ The WhatsApp bot now uses these details.', true);
//       await loadStore();
//     } catch (error) {
//       say('sl-save-msg', error.message, false);
//     }
//   }

//   async function connect() {
//     try {
//       const out = await api('/connect', 'POST', {
//         phone_number_id: val('sl-pid'),
//         waba_id: val('sl-waba'),
//         display_phone: val('sl-disp'),
//         access_token: val('sl-token')
//       });

//       $('sl-wa-msg').style.color = '#34d399';
//       $('sl-wa-msg').textContent = `Connected ✅ ${out.display_phone || ''} ${out.verified_name ? '(' + out.verified_name + ')' : ''}\nNow press "Check connection", then send "Hi" to the number from your phone.`;

//       $('sl-token').value = '';
//       await loadStore();
//     } catch (error) {
//       $('sl-wa-msg').style.color = '#f87171';
//       $('sl-wa-msg').textContent = error.message;
//     }
//   }

//   async function health() {
//     try {
//       const out = await api('/health');

//       $('sl-wa-msg').style.color = out.all_ok ? '#34d399' : '#f87171';
//       $('sl-wa-msg').textContent =
//         (out.all_ok ? 'ALL GOOD ✅\n' : 'PROBLEM ❌\n') +
//         out.checks.map(c => `${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ' - ' + c.detail : ''}`).join('\n');
//     } catch (error) {
//       $('sl-wa-msg').style.color = '#f87171';
//       $('sl-wa-msg').textContent = error.message;
//     }
//   }

//   function when(value) {
//     return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
//   }

//   async function loadBookings(which) {
//     bookingsWhen = which === 'past' ? 'past' : 'upcoming';

//     const body = $('sl-bookings');
//     if (!body) return;

//     try {
//       const data = await api(`/appointments?when=${bookingsWhen}`);
//       const rows = data.appointments || [];

//       body.innerHTML = rows.length
//         ? rows
//             .map(
//               a => `
//           <tr>
//             <td>${esc(a.id)}</td>
//             <td><div style="font-weight:600;color:#fff;">${esc(a.customer_name)}</div><div style="font-size:0.72rem;color:#64748b;">+${esc(a.customer_phone)}</div></td>
//             <td>${esc(a.service)}</td>
//             <td>${esc(when(a.start_at))}</td>
//             <td>${esc(a.status)}</td>
//             <td>${a.status === 'confirmed' && bookingsWhen === 'upcoming' ? `<button class="btn btn-secondary" onclick="salonCancel(${Number(a.id)})" style="width:auto;padding:2px 8px;font-size:0.72rem;border-color:#ef4444;color:#f87171;">Cancel</button>` : ''}</td>
//           </tr>`
//             )
//             .join('')
//         : `<tr><td colspan="6" style="text-align:center;color:#888;">No ${bookingsWhen} appointments.</td></tr>`;
//     } catch (error) {
//       body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#f87171;">${esc(error.message)}</td></tr>`;
//     }
//   }

//   async function cancel(id) {
//     if (!confirm(`Cancel booking #${id}? The customer is told on WhatsApp and it is removed from the calendar.`)) return;

//     try {
//       await api(`/appointments/${encodeURIComponent(id)}/cancel`, 'POST', {});
//       say('sl-book-msg', `Booking #${id} cancelled ✅`, true);
//     } catch (error) {
//       say('sl-book-msg', error.message, false);
//     }

//     loadBookings(bookingsWhen);
//   }

//   function renderHolidays(days) {
//     const box = $('sl-holidays');
//     if (!box) return;

//     box.innerHTML = days.length
//       ? days
//           .map(
//             d => `<span style="background:rgba(255,255,255,0.06);border:1px solid var(--border-color);border-radius:999px;padding:3px 10px;font-size:0.75rem;">
//                     ${esc(d)} <a href="#" onclick="salonRemoveHoliday('${esc(d)}');return false;" style="color:#f87171;text-decoration:none;margin-left:4px;">✕</a></span>`
//           )
//           .join('')
//       : '<span style="font-size:0.75rem;color:var(--text-secondary);">No upcoming closed days.</span>';
//   }

//   async function addHoliday() {
//     try {
//       await api('/holiday', 'POST', { day: val('sl-holiday') });
//       say('sl-book-msg', 'Marked closed ✅', true);
//       await loadStore();
//     } catch (error) {
//       say('sl-book-msg', error.message, false);
//     }
//   }

//   async function removeHoliday(day) {
//     try {
//       await api(`/holiday/${encodeURIComponent(day)}`, 'DELETE');
//       await loadStore();
//     } catch (error) {
//       say('sl-book-msg', error.message, false);
//     }
//   }

//   async function pickStore() {
//     storeId = $('sl-store-pick')?.value || '';

//     const body = $('sl-body');
//     if (body) body.style.display = storeId ? '' : 'none';

//     if (storeId) {
//       try {
//         await loadStore();
//       } catch (error) {
//         say('sl-save-msg', error.message, false);
//       }
//     }
//   }

//   /* ---------------- start ---------------- */

//   function showTab(only) {
//     $('salon-tab-btn').style.display = '';

//     if (only) {
//       // A parlour owner has no use for the clothing / electronics tabs
//       document.querySelectorAll('.tab-btn').forEach(btn => {
//         if (btn.id !== 'salon-tab-btn') btn.style.display = 'none';
//       });

//       $('salon-tab-btn').click();
//     }
//   }

//   async function start() {
//     if (started) return;
//     started = true;

//     if (!$('tab-salon') || !$('salon-tab-btn')) return;

//     let state;

//     try {
//       state = await api('/state');
//     } catch (error) {
//       console.warn('[Parlour] not available:', error.message);
//       return;
//     }

//     if (!state.enabled) return;

//     isAdmin = Boolean(state.is_admin);
//     serviceAccount = state.service_account_email || null;

//     if (isAdmin) {
//       if (!buildScreen()) return;

//       try {
//         const res = await fetch('/api/catalog/stores', { credentials: 'same-origin', cache: 'no-store' });
//         const data = await res.json();

//         const list = (data.stores || []).map(s => ({ id: s.id, label: `${s.business_name || s.name || s.id} (${s.id})` }));

//         // Parlours created earlier from salon-admin.html use their own ids: list them too
//         try {
//           const extra = await api('/stores');

//           (extra.stores || []).forEach(s => {
//             if (!list.some(x => String(x.id) === String(s.store_id))) {
//               list.push({ id: s.store_id, label: `💅 ${s.name} (${s.store_id})` });
//             }
//           });
//         } catch (error) {
//           console.warn('[Parlour] could not list parlours', error.message);
//         }

//         $('sl-store-pick').innerHTML =
//           '<option value="">- choose a business -</option>' +
//           list.map(s => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('');
//       } catch (error) {
//         console.warn('[Parlour] could not list stores', error.message);
//       }

//       $('sl-body').style.display = 'none';
//       showTab(false);
//       return;
//     }

//     // Business owner: only when a parlour was set up for them
//     if (!state.exists) return;

//     if (!buildScreen()) return;

//     showTab(true);
//     fillForm(state);
//     loadBookings('upcoming');
//   }

//   Object.assign(window, {
//     salonSave: save,
//     salonConnect: connect,
//     salonHealth: health,
//     salonLoadBookings: loadBookings,
//     salonCancel: cancel,
//     salonAddHoliday: addHoliday,
//     salonRemoveHoliday: removeHoliday,
//     salonPickStore: pickStore,
//     salonFindSlots: findSlots,
//     salonPickTime: pickTime,
//     salonBook: book
//   });

//   if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
//   else start();

//   // Re-check every few minutes so a booking made on WhatsApp appears without a refresh
//   setInterval(() => {
//     const tab = $('tab-salon');
//     if (started && tab && tab.offsetParent !== null && $('sl-bookings')) loadBookings(bookingsWhen);
//   }, 30000);
// })();