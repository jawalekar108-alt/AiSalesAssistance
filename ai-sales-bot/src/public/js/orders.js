//18/10

const ORDER_STATUSES = ['NEW', 'PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

const ORDER_COLORS = {
  NEW: '#60a5fa',
  PENDING_PAYMENT: '#fbbf24',
  PAID: '#34d399',
  CONFIRMED: '#34d399',
  SHIPPED: '#a78bfa',
  DELIVERED: '#10b981',
  CANCELLED: '#f87171'
};

// Orders whose currency is missing fall back to ₹
const ORDER_POLL_MS = 20000;

let knownOrderIds = null; // null = first load not finished yet

function ordEsc(value) {
  if (value === null || value === undefined) return '';

  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function ordStoreId() {
  return document.getElementById('orders-store-filter')?.value || 'clothing';
}

function ordMoney(order, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${order.currency || '₹'}${n.toLocaleString('en-IN')}`;
}

function ordTabActive() {
  const tab = document.getElementById('tab-orders');
  // offsetParent is null while the section is hidden, however the tab switcher hides it
  return Boolean(tab && tab.offsetParent !== null);
}

function ordSetMessage(text, ok = true) {
  const el = document.getElementById('orders-msg');
  if (!el) return;

  el.style.color = ok ? '#34d399' : '#f87171';
  el.textContent = text || '';
}

function ordShowBanner(count) {
  const el = document.getElementById('orders-banner');
  if (!el) return;

  el.textContent = `🛒 ${count} new order${count > 1 ? 's' : ''} received! Click to dismiss.`;
  el.style.display = 'block';
}

function ordDismissBanner() {
  const el = document.getElementById('orders-banner');
  if (el) el.style.display = 'none';
}

function ordSetStat(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderOrders(orders) {
  const tbody = document.getElementById('orders-table-body');
  if (!tbody) return;

  const currency = orders[0]?.currency || '₹';

  const waiting = orders.filter(o => o.status === 'NEW' || o.status === 'PENDING_PAYMENT').length;
  const delivered = orders.filter(o => o.status === 'DELIVERED').length;
  const revenue = orders
    .filter(o => o.status !== 'CANCELLED')
    .reduce((sum, o) => sum + (Number(o.total) || 0), 0);

  ordSetStat('ord-stat-total', orders.length);
  ordSetStat('ord-stat-waiting', waiting);
  ordSetStat('ord-stat-delivered', delivered);
  ordSetStat('ord-stat-revenue', `${currency}${revenue.toLocaleString('en-IN')}`);

  if (!orders.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="text-align:center;color:#888;">No orders yet. They appear here as soon as a customer places one on WhatsApp.</td></tr>';
    return;
  }

  tbody.innerHTML = orders
    .map(o => {
      const color = ORDER_COLORS[o.status] || '#94a3b8';
      const when = o.created_at ? new Date(o.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

      const options = ORDER_STATUSES.map(
        s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`
      ).join('');

      return `
        <tr>
          <td>
            <div style="font-weight:700;color:#fff;">${ordEsc(o.id)}</div>
            <div style="font-size:0.72rem;color:#64748b;">${ordEsc(when)}</div>
          </td>
          <td>
            <div style="font-weight:600;color:#fff;">${ordEsc(o.customer_name)}</div>
            <div style="font-size:0.72rem;color:#64748b;">${ordEsc(o.customer_phone)}</div>
          </td>
          <td style="max-width:240px;">
            <div style="color:#cbd5e1;font-size:0.8rem;">${ordEsc(o.product_name)}</div>
            <div style="font-size:0.72rem;color:#64748b;margin-top:2px;">📍 ${ordEsc(o.address)}</div>
          </td>
          <td><strong style="color:#34d399;">${ordMoney(o, o.total)}</strong></td>
          <td>
            <div style="font-size:0.8rem;">${o.payment === 'UPI' ? '📲 UPI' : '💵 COD'}</div>
            ${o.payment_proof_media_id ? '<div style="font-size:0.7rem;color:#fbbf24;">📸 screenshot received</div>' : ''}
          </td>
          <td>
            <span style="font-size:0.72rem;padding:3px 8px;border-radius:6px;font-weight:700;background:${color}22;color:${color};">
              ${ordEsc(o.status.replace(/_/g, ' '))}
            </span>
          </td>
          <td>
            <select class="phone-input" style="font-size:0.75rem;padding:0.3rem;border:1px solid var(--border-color);"
              onchange="changeOrderStatus('${ordEsc(o.id)}', this.value)">
              ${options}
            </select>
          </td>
        </tr>`;
    })
    .join('');
}

async function loadOrders(silent = false) {
  const tbody = document.getElementById('orders-table-body');
  if (!tbody) return;

  try {
    const res = await fetch(`/api/orders?store_id=${encodeURIComponent(ordStoreId())}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'x-store-id': ordStoreId() }
    });
    const data = await res.json();

    if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);

    const orders = data.orders || [];

    // New order detection (after the first successful load)
    if (knownOrderIds !== null) {
      const fresh = orders.filter(o => !knownOrderIds.has(o.id));

      if (fresh.length) {
        ordShowBanner(fresh.length);

        if (!ordTabActive()) {
          const badge = document.getElementById('orders-tab-badge');
          if (badge) badge.textContent = ' 🔴';
        }
      }
    }

    knownOrderIds = new Set(orders.map(o => o.id));

    renderOrders(orders);
  } catch (error) {
    console.error('[Orders] Load failed:', error);

    if (silent && !ordTabActive()) return;

    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#f87171;">Could not load orders: ${ordEsc(error.message)}</td></tr>`;
  }
}

async function changeOrderStatus(id, status) {
  const notify = document.getElementById('orders-notify-customer')?.checked !== false;

  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-store-id': ordStoreId() },
      body: JSON.stringify({ store_id: ordStoreId(), status, notify })
    });

    const data = await res.json();

    if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);

    let message = `Order ${id} marked ${status.replace(/_/g, ' ')}.`;

    if (notify) {
      message += data.customer_notified
        ? ' Customer notified on WhatsApp ✅'
        : ` Customer not messaged: ${data.hint || 'no message is sent for this status.'}`;
    }

    ordSetMessage(message, true);
  } catch (error) {
    ordSetMessage(`Could not update order: ${error.message}`, false);
  }

  loadOrders(true);
}

function ordersStoreChanged() {
  knownOrderIds = null; // do not show a "new order" banner for the other store's orders
  ordDismissBanner();
  loadOrders();
}

/* ---------- start ---------- */

document.querySelector('.tab-btn[data-tab="orders"]')?.addEventListener('click', () => {
  const badge = document.getElementById('orders-tab-badge');
  if (badge) badge.textContent = '';

  loadOrders();
});

loadOrders(true);
setInterval(() => loadOrders(true), ORDER_POLL_MS);


//13/10

// /* ============================================================
//  * ORDERS TAB (dashboard)
//  * Needs: GET /api/orders and PATCH /api/orders/:id/status
//  * ============================================================ */

// const ORDER_STATUSES = ['NEW', 'PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

// const ORDER_COLORS = {
//   NEW: '#60a5fa',
//   PENDING_PAYMENT: '#fbbf24',
//   PAID: '#34d399',
//   CONFIRMED: '#34d399',
//   SHIPPED: '#a78bfa',
//   DELIVERED: '#10b981',
//   CANCELLED: '#f87171'
// };

// const ORDER_POLL_MS = 20000;

// let knownOrderIds = null; // null = first load not finished yet

// function ordEsc(value) {
//   if (value === null || value === undefined) return '';

//   return String(value)
//     .replace(/&/g, '&amp;')
//     .replace(/</g, '&lt;')
//     .replace(/>/g, '&gt;')
//     .replace(/"/g, '&quot;')
//     .replace(/'/g, '&#039;');
// }

// function ordStoreId() {
//   return document.getElementById('orders-store-filter')?.value || 'clothing';
// }

// function ordMoney(order, value) {
//   const n = Number(value);
//   if (!Number.isFinite(n)) return '—';
//   return `${order.currency || '₹'}${n.toLocaleString('en-IN')}`;
// }

// function ordTabActive() {
//   const tab = document.getElementById('tab-orders');
//   // offsetParent is null while the section is hidden, however the tab switcher hides it
//   return Boolean(tab && tab.offsetParent !== null);
// }

// function ordSetMessage(text, ok = true) {
//   const el = document.getElementById('orders-msg');
//   if (!el) return;

//   el.style.color = ok ? '#34d399' : '#f87171';
//   el.textContent = text || '';
// }

// function ordShowBanner(count) {
//   const el = document.getElementById('orders-banner');
//   if (!el) return;

//   el.textContent = `🛒 ${count} new order${count > 1 ? 's' : ''} received! Click to dismiss.`;
//   el.style.display = 'block';
// }

// function ordDismissBanner() {
//   const el = document.getElementById('orders-banner');
//   if (el) el.style.display = 'none';
// }

// function ordSetStat(id, value) {
//   const el = document.getElementById(id);
//   if (el) el.textContent = value;
// }

// function renderOrders(orders) {
//   const tbody = document.getElementById('orders-table-body');
//   if (!tbody) return;

//   const currency = orders[0]?.currency || '₹';

//   const waiting = orders.filter(o => o.status === 'NEW' || o.status === 'PENDING_PAYMENT').length;
//   const delivered = orders.filter(o => o.status === 'DELIVERED').length;
//   const revenue = orders
//     .filter(o => o.status !== 'CANCELLED')
//     .reduce((sum, o) => sum + (Number(o.total) || 0), 0);

//   ordSetStat('ord-stat-total', orders.length);
//   ordSetStat('ord-stat-waiting', waiting);
//   ordSetStat('ord-stat-delivered', delivered);
//   ordSetStat('ord-stat-revenue', `${currency}${revenue.toLocaleString('en-IN')}`);

//   if (!orders.length) {
//     tbody.innerHTML =
//       '<tr><td colspan="7" style="text-align:center;color:#888;">No orders yet. They appear here as soon as a customer places one on WhatsApp.</td></tr>';
//     return;
//   }

//   tbody.innerHTML = orders
//     .map(o => {
//       const color = ORDER_COLORS[o.status] || '#94a3b8';
//       const when = o.created_at ? new Date(o.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

//       const options = ORDER_STATUSES.map(
//         s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`
//       ).join('');

//       return `
//         <tr>
//           <td>
//             <div style="font-weight:700;color:#fff;">${ordEsc(o.id)}</div>
//             <div style="font-size:0.72rem;color:#64748b;">${ordEsc(when)}</div>
//           </td>
//           <td>
//             <div style="font-weight:600;color:#fff;">${ordEsc(o.customer_name)}</div>
//             <div style="font-size:0.72rem;color:#64748b;">${ordEsc(o.customer_phone)}</div>
//           </td>
//           <td style="max-width:240px;">
//             <div style="color:#cbd5e1;font-size:0.8rem;">${ordEsc(o.product_name)}</div>
//             <div style="font-size:0.72rem;color:#64748b;margin-top:2px;">📍 ${ordEsc(o.address)}</div>
//           </td>
//           <td><strong style="color:#34d399;">${ordMoney(o, o.total)}</strong></td>
//           <td>
//             <div style="font-size:0.8rem;">${o.payment === 'UPI' ? '📲 UPI' : '💵 COD'}</div>
//             ${o.payment_proof_media_id ? '<div style="font-size:0.7rem;color:#fbbf24;">📸 screenshot received</div>' : ''}
//           </td>
//           <td>
//             <span style="font-size:0.72rem;padding:3px 8px;border-radius:6px;font-weight:700;background:${color}22;color:${color};">
//               ${ordEsc(o.status.replace(/_/g, ' '))}
//             </span>
//           </td>
//           <td>
//             <select class="phone-input" style="font-size:0.75rem;padding:0.3rem;border:1px solid var(--border-color);"
//               onchange="changeOrderStatus('${ordEsc(o.id)}', this.value)">
//               ${options}
//             </select>
//           </td>
//         </tr>`;
//     })
//     .join('');
// }

// async function loadOrders(silent = false) {
//   const tbody = document.getElementById('orders-table-body');
//   if (!tbody) return;

//   try {
//     const res = await fetch(`/api/orders?store_id=${encodeURIComponent(ordStoreId())}`);
//     const data = await res.json();

//     if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);

//     const orders = data.orders || [];

//     // New order detection (after the first successful load)
//     if (knownOrderIds !== null) {
//       const fresh = orders.filter(o => !knownOrderIds.has(o.id));

//       if (fresh.length) {
//         ordShowBanner(fresh.length);

//         if (!ordTabActive()) {
//           const badge = document.getElementById('orders-tab-badge');
//           if (badge) badge.textContent = ' 🔴';
//         }
//       }
//     }

//     knownOrderIds = new Set(orders.map(o => o.id));

//     renderOrders(orders);
//   } catch (error) {
//     console.error('[Orders] Load failed:', error);

//     if (silent && !ordTabActive()) return;

//     tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#f87171;">Could not load orders: ${ordEsc(error.message)}</td></tr>`;
//   }
// }

// async function changeOrderStatus(id, status) {
//   const notify = document.getElementById('orders-notify-customer')?.checked !== false;

//   try {
//     const res = await fetch(`/api/orders/${encodeURIComponent(id)}/status`, {
//       method: 'PATCH',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ store_id: ordStoreId(), status, notify })
//     });

//     const data = await res.json();

//     if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);

//     let message = `Order ${id} marked ${status.replace(/_/g, ' ')}.`;

//     if (notify) {
//       message += data.customer_notified
//         ? ' Customer notified on WhatsApp ✅'
//         : ` Customer not messaged: ${data.hint || 'no message is sent for this status.'}`;
//     }

//     ordSetMessage(message, true);
//   } catch (error) {
//     ordSetMessage(`Could not update order: ${error.message}`, false);
//   }

//   loadOrders(true);
// }

// function ordersStoreChanged() {
//   knownOrderIds = null; // do not show a "new order" banner for the other store's orders
//   ordDismissBanner();
//   loadOrders();
// }

// /* ---------- start ---------- */

// document.querySelector('.tab-btn[data-tab="orders"]')?.addEventListener('click', () => {
//   const badge = document.getElementById('orders-tab-badge');
//   if (badge) badge.textContent = '';

//   loadOrders();
// });

// loadOrders(true);
// setInterval(() => loadOrders(true), ORDER_POLL_MS);



// /* ============================================================
//  * ORDERS TAB (dashboard)
//  * Needs: GET /api/orders and PATCH /api/orders/:id/status
//  * ============================================================ */

// const ORDER_STATUSES = ['NEW', 'PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

// const ORDER_COLORS = {
//   NEW: '#60a5fa',
//   PENDING_PAYMENT: '#fbbf24',
//   PAID: '#34d399',
//   CONFIRMED: '#34d399',
//   SHIPPED: '#a78bfa',
//   DELIVERED: '#10b981',
//   CANCELLED: '#f87171'
// };

// const ORDER_POLL_MS = 20000;

// let knownOrderIds = null; // null = first load not finished yet

// function ordEsc(value) {
//   if (value === null || value === undefined) return '';

//   return String(value)
//     .replace(/&/g, '&amp;')
//     .replace(/</g, '&lt;')
//     .replace(/>/g, '&gt;')
//     .replace(/"/g, '&quot;')
//     .replace(/'/g, '&#039;');
// }

// function ordStoreId() {
//   return document.getElementById('orders-store-filter')?.value || 'clothing';
// }

// function ordMoney(order, value) {
//   const n = Number(value);
//   if (!Number.isFinite(n)) return '—';
//   return `${order.currency || '₹'}${n.toLocaleString('en-IN')}`;
// }

// function ordTabActive() {
//   const tab = document.getElementById('tab-orders');
//   // offsetParent is null while the section is hidden, however the tab switcher hides it
//   return Boolean(tab && tab.offsetParent !== null);
// }

// function ordSetMessage(text, ok = true) {
//   const el = document.getElementById('orders-msg');
//   if (!el) return;

//   el.style.color = ok ? '#34d399' : '#f87171';
//   el.textContent = text || '';
// }

// function ordShowBanner(count) {
//   const el = document.getElementById('orders-banner');
//   if (!el) return;

//   el.textContent = `🛒 ${count} new order${count > 1 ? 's' : ''} received! Click to dismiss.`;
//   el.style.display = 'block';
// }

// function ordDismissBanner() {
//   const el = document.getElementById('orders-banner');
//   if (el) el.style.display = 'none';
// }

// function ordSetStat(id, value) {
//   const el = document.getElementById(id);
//   if (el) el.textContent = value;
// }

// function renderOrders(orders) {
//   const tbody = document.getElementById('orders-table-body');
//   if (!tbody) return;

//   const currency = orders[0]?.currency || '₹';

//   const waiting = orders.filter(o => o.status === 'NEW' || o.status === 'PENDING_PAYMENT').length;
//   const delivered = orders.filter(o => o.status === 'DELIVERED').length;
//   const revenue = orders
//     .filter(o => o.status !== 'CANCELLED')
//     .reduce((sum, o) => sum + (Number(o.total) || 0), 0);

//   ordSetStat('ord-stat-total', orders.length);
//   ordSetStat('ord-stat-waiting', waiting);
//   ordSetStat('ord-stat-delivered', delivered);
//   ordSetStat('ord-stat-revenue', `${currency}${revenue.toLocaleString('en-IN')}`);

//   if (!orders.length) {
//     tbody.innerHTML =
//       '<tr><td colspan="7" style="text-align:center;color:#888;">No orders yet. They appear here as soon as a customer places one on WhatsApp.</td></tr>';
//     return;
//   }

//   tbody.innerHTML = orders
//     .map(o => {
//       const color = ORDER_COLORS[o.status] || '#94a3b8';
//       const when = o.created_at ? new Date(o.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

//       const options = ORDER_STATUSES.map(
//         s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`
//       ).join('');

//       return `
//         <tr>
//           <td>
//             <div style="font-weight:700;color:#fff;">${ordEsc(o.id)}</div>
//             <div style="font-size:0.72rem;color:#64748b;">${ordEsc(when)}</div>
//           </td>
//           <td>
//             <div style="font-weight:600;color:#fff;">${ordEsc(o.customer_name)}</div>
//             <div style="font-size:0.72rem;color:#64748b;">${ordEsc(o.customer_phone)}</div>
//           </td>
//           <td style="max-width:240px;">
//             <div style="color:#cbd5e1;font-size:0.8rem;">${ordEsc(o.product_name)}</div>
//             <div style="font-size:0.72rem;color:#64748b;margin-top:2px;">📍 ${ordEsc(o.address)}</div>
//           </td>
//           <td><strong style="color:#34d399;">${ordMoney(o, o.total)}</strong></td>
//           <td>
//             <div style="font-size:0.8rem;">${o.payment === 'UPI' ? '📲 UPI' : '💵 COD'}</div>
//             ${o.payment_proof_media_id ? '<div style="font-size:0.7rem;color:#fbbf24;">📸 screenshot received</div>' : ''}
//           </td>
//           <td>
//             <span style="font-size:0.72rem;padding:3px 8px;border-radius:6px;font-weight:700;background:${color}22;color:${color};">
//               ${ordEsc(o.status.replace(/_/g, ' '))}
//             </span>
//           </td>
//           <td>
//             <select class="phone-input" style="font-size:0.75rem;padding:0.3rem;border:1px solid var(--border-color);"
//               onchange="changeOrderStatus('${ordEsc(o.id)}', this.value)">
//               ${options}
//             </select>
//           </td>
//         </tr>`;
//     })
//     .join('');
// }

// async function loadOrders(silent = false) {
//   const tbody = document.getElementById('orders-table-body');
//   if (!tbody) return;

//   try {
//     const res = await fetch(`/api/orders?store_id=${encodeURIComponent(ordStoreId())}`);
//     const data = await res.json();

//     if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);

//     const orders = data.orders || [];

//     // New order detection (after the first successful load)
//     if (knownOrderIds !== null) {
//       const fresh = orders.filter(o => !knownOrderIds.has(o.id));

//       if (fresh.length) {
//         ordShowBanner(fresh.length);

//         if (!ordTabActive()) {
//           const badge = document.getElementById('orders-tab-badge');
//           if (badge) badge.textContent = ' 🔴';
//         }
//       }
//     }

//     knownOrderIds = new Set(orders.map(o => o.id));

//     renderOrders(orders);
//   } catch (error) {
//     console.error('[Orders] Load failed:', error);

//     if (silent && !ordTabActive()) return;

//     tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#f87171;">Could not load orders: ${ordEsc(error.message)}</td></tr>`;
//   }
// }

// async function changeOrderStatus(id, status) {
//   const notify = document.getElementById('orders-notify-customer')?.checked !== false;

//   try {
//     const res = await fetch(`/api/orders/${encodeURIComponent(id)}/status`, {
//       method: 'PATCH',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ store_id: ordStoreId(), status, notify })
//     });

//     const data = await res.json();

//     if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);

//     let message = `Order ${id} marked ${status.replace(/_/g, ' ')}.`;

//     if (notify) {
//       message += data.customer_notified
//         ? ' Customer notified on WhatsApp ✅'
//         : ` Customer not messaged: ${data.hint || 'no message is sent for this status.'}`;
//     }

//     ordSetMessage(message, true);
//   } catch (error) {
//     ordSetMessage(`Could not update order: ${error.message}`, false);
//   }

//   loadOrders(true);
// }

// function ordersStoreChanged() {
//   knownOrderIds = null; // do not show a "new order" banner for the other store's orders
//   ordDismissBanner();
//   loadOrders();
// }

// /* ---------- start ---------- */

// document.querySelector('.tab-btn[data-tab="orders"]')?.addEventListener('click', () => {
//   const badge = document.getElementById('orders-tab-badge');
//   if (badge) badge.textContent = '';

//   loadOrders();
// });

// loadOrders(true);
// setInterval(() => loadOrders(true), ORDER_POLL_MS);
