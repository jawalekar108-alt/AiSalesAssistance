//18/10

function crmEsc(value) {
  if (value === null || value === undefined) return '';

  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Which store the CRM shows: its own selector if you add one, otherwise the Catalog selector
function crmStoreId() {
  return (
    document.getElementById('crm-store-filter')?.value ||
    document.getElementById('catalog-store-filter')?.value ||
    'clothing'
  );
}

function crmMoney(value) {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return value ?? '—';
  return '₹' + n.toLocaleString('en-IN');
}

function crmShowError(message) {
  const tbody = document.getElementById('crm-leads-table-body');

  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#f87171;">Could not load leads: ${crmEsc(message)}</td></tr>`;
  }

  // Do not leave the fake placeholder numbers from index.html on screen
  ['stat-conversations', 'stat-hot-leads', 'stat-converted', 'stat-revenue'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerText = '—';
  });
}

async function crmFetchJson(path) {
  const storeId = crmStoreId();
  const url = `${path}${path.includes('?') ? '&' : '?'}store_id=${encodeURIComponent(storeId)}`;

  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'x-store-id': storeId }
  });

  if (res.redirected && /login/i.test(res.url)) {
    throw new Error('Your session expired. Please log in again.');
  }

  let data = null;

  try {
    data = await res.json();
  } catch {
    throw new Error(`${path} did not return JSON (HTTP ${res.status}). Restart the server, or log in again.`);
  }

  if (!res.ok || !data.success) {
    throw new Error(data.error || data.message || `${path} failed (HTTP ${res.status})`);
  }

  return data;
}

async function loadCRMView() {
  try {
    // 1. High level analytics
    const analyticsData = await crmFetchJson('/api/leads/analytics');
    const a = analyticsData.analytics || {};

    document.getElementById('stat-conversations').innerText = a.totalConversations ?? 0;
    document.getElementById('stat-hot-leads').innerText = a.hotLeads ?? 0;
    document.getElementById('stat-converted').innerText = a.convertedLeads ?? 0;
    document.getElementById('stat-revenue').innerText = crmMoney(a.totalRevenue ?? 0);

    // 2. Leads list
    const leadsData = await crmFetchJson('/api/leads/leads');
    renderCRMTable(leadsData.leads);
  } catch (err) {
    console.error('Failed to load CRM:', err);
    crmShowError(err.message);
  }
}

function renderCRMTable(leads) {
  const tbody = document.getElementById('crm-leads-table-body');
  if (!tbody) return;

  if (!leads || leads.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="text-align: center; color: #888;">No leads generated yet. Run a chat in the simulator!</td></tr>';
    return;
  }

  tbody.innerHTML = leads
    .map(l => {
      const formattedDate = new Date(l.created_at).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      const intent = l.intent_score || 'WARM';
      const isHot = intent === 'HOT';
      const isConverted = ['CHECKOUT_CLICKED', 'ORDER_REQUESTED', 'PURCHASED'].includes(l.status);
      const isClothing = (l.store_type || l.store_id) === 'clothing';
      const value = Number(l.cart_value) || 0;

      return `
      <tr>
        <td>
          <div style="font-weight: 700; color: #fff;">${crmEsc(l.customer_handle || '@shopper')}</div>
          <div style="font-size: 0.72rem; color: #64748b;">${crmEsc(l.customer_name || 'Customer')}</div>
        </td>
        <td>
          <span style="font-size: 0.75rem; text-transform: uppercase; color: ${isClothing ? '#f472b6' : '#60a5fa'}; font-weight: 700;">
            ${isClothing ? '👗 Clothing' : (l.store_type === 'electronics' ? '⚡ Tech' : '🏪 ' + crmEsc(l.store_name || l.store_type || l.store_id || 'Store'))}
          </span>
        </td>
        <td>
          <span style="color: #cbd5e1; font-size: 0.8rem;">${crmEsc(l.interested_product || 'Pending selection')}</span>
        </td>
        <td>
          <strong style="color: #34d399;">₹${value.toLocaleString('en-IN')}</strong>
        </td>
        <td>
          <span class="intent-badge intent-${crmEsc(intent)}">
            ${isHot ? '🔥' : '⚡'} ${crmEsc(intent)}
          </span>
        </td>
        <td>
          <span style="font-size: 0.75rem; padding: 3px 8px; border-radius: 6px; font-weight: 700; background: ${isConverted ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.15)'}; color: ${isConverted ? '#34d399' : '#60a5fa'};">
            ${crmEsc(l.status)}
          </span>
        </td>
        <td style="color: #64748b; font-size: 0.75rem;">
          ${crmEsc(formattedDate)}
        </td>
      </tr>
    `;
    })
    .join('');
}

// Reload every time the CRM tab is opened (safe even if simulator.js already does this)
document.querySelector('.tab-btn[data-tab="crm"]')?.addEventListener('click', loadCRMView);

// If the store selector changes while the CRM tab is open, reload it
document.getElementById('catalog-store-filter')?.addEventListener('change', () => {
  if (document.getElementById('tab-crm')?.classList.contains('active')) loadCRMView();
});


//13/10
/* ============================================================
 * LEADS CRM & ANALYTICS
 * Needs: GET /api/leads/analytics and GET /api/leads/leads
 * Both calls send store_id (the server rejects them without it for admin users).
 * ============================================================ */

function crmEsc(value) {
  if (value === null || value === undefined) return '';

  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Which store the CRM shows: its own selector if you add one, otherwise the Catalog selector
function crmStoreId() {
  return (
    document.getElementById('crm-store-filter')?.value ||
    document.getElementById('catalog-store-filter')?.value ||
    'clothing'
  );
}

function crmMoney(value) {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return value ?? '—';
  return '₹' + n.toLocaleString('en-IN');
}

function crmShowError(message) {
  const tbody = document.getElementById('crm-leads-table-body');

  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#f87171;">Could not load leads: ${crmEsc(message)}</td></tr>`;
  }

  // Do not leave the fake placeholder numbers from index.html on screen
  ['stat-conversations', 'stat-hot-leads', 'stat-converted', 'stat-revenue'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerText = '—';
  });
}

async function crmFetchJson(path) {
  const storeId = crmStoreId();
  const url = `${path}${path.includes('?') ? '&' : '?'}store_id=${encodeURIComponent(storeId)}`;

  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'x-store-id': storeId }
  });

  if (res.redirected && /login/i.test(res.url)) {
    throw new Error('Your session expired. Please log in again.');
  }

  let data = null;

  try {
    data = await res.json();
  } catch {
    throw new Error(`${path} did not return JSON (HTTP ${res.status}). Restart the server, or log in again.`);
  }

  if (!res.ok || !data.success) {
    throw new Error(data.error || data.message || `${path} failed (HTTP ${res.status})`);
  }

  return data;
}

async function loadCRMView() {
  try {
    // 1. High level analytics
    const analyticsData = await crmFetchJson('/api/leads/analytics');
    const a = analyticsData.analytics || {};

    document.getElementById('stat-conversations').innerText = a.totalConversations ?? 0;
    document.getElementById('stat-hot-leads').innerText = a.hotLeads ?? 0;
    document.getElementById('stat-converted').innerText = a.convertedLeads ?? 0;
    document.getElementById('stat-revenue').innerText = crmMoney(a.totalRevenue ?? 0);

    // 2. Leads list
    const leadsData = await crmFetchJson('/api/leads/leads');
    renderCRMTable(leadsData.leads);
  } catch (err) {
    console.error('Failed to load CRM:', err);
    crmShowError(err.message);
  }
}

function renderCRMTable(leads) {
  const tbody = document.getElementById('crm-leads-table-body');
  if (!tbody) return;

  if (!leads || leads.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="text-align: center; color: #888;">No leads generated yet. Run a chat in the simulator!</td></tr>';
    return;
  }

  tbody.innerHTML = leads
    .map(l => {
      const formattedDate = new Date(l.created_at).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      const intent = l.intent_score || 'WARM';
      const isHot = intent === 'HOT';
      const isConverted = ['CHECKOUT_CLICKED', 'ORDER_REQUESTED', 'PURCHASED'].includes(l.status);
      const isClothing = (l.store_type || l.store_id) === 'clothing';
      const value = Number(l.cart_value) || 0;

      return `
      <tr>
        <td>
          <div style="font-weight: 700; color: #fff;">${crmEsc(l.customer_handle || '@shopper')}</div>
          <div style="font-size: 0.72rem; color: #64748b;">${crmEsc(l.customer_name || 'Customer')}</div>
        </td>
        <td>
          <span style="font-size: 0.75rem; text-transform: uppercase; color: ${isClothing ? '#f472b6' : '#60a5fa'}; font-weight: 700;">
            ${isClothing ? '👗 Clothing' : '⚡ Tech'}
          </span>
        </td>
        <td>
          <span style="color: #cbd5e1; font-size: 0.8rem;">${crmEsc(l.interested_product || 'Pending selection')}</span>
        </td>
        <td>
          <strong style="color: #34d399;">₹${value.toLocaleString('en-IN')}</strong>
        </td>
        <td>
          <span class="intent-badge intent-${crmEsc(intent)}">
            ${isHot ? '🔥' : '⚡'} ${crmEsc(intent)}
          </span>
        </td>
        <td>
          <span style="font-size: 0.75rem; padding: 3px 8px; border-radius: 6px; font-weight: 700; background: ${isConverted ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.15)'}; color: ${isConverted ? '#34d399' : '#60a5fa'};">
            ${crmEsc(l.status)}
          </span>
        </td>
        <td style="color: #64748b; font-size: 0.75rem;">
          ${crmEsc(formattedDate)}
        </td>
      </tr>
    `;
    })
    .join('');
}

// Reload every time the CRM tab is opened (safe even if simulator.js already does this)
document.querySelector('.tab-btn[data-tab="crm"]')?.addEventListener('click', loadCRMView);

// If the store selector changes while the CRM tab is open, reload it
document.getElementById('catalog-store-filter')?.addEventListener('change', () => {
  if (document.getElementById('tab-crm')?.classList.contains('active')) loadCRMView();
});

//13/10(old file)

// function crmEsc(value) {
//   if (value === null || value === undefined) return '';

//   return String(value)
//     .replace(/&/g, '&amp;')
//     .replace(/</g, '&lt;')
//     .replace(/>/g, '&gt;')
//     .replace(/"/g, '&quot;')
//     .replace(/'/g, '&#039;');
// }

// function crmShowError(message) {
//   const tbody = document.getElementById('crm-leads-table-body');

//   if (tbody) {
//     tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#f87171;">Could not load leads: ${crmEsc(message)}</td></tr>`;
//   }

//   // Do not leave the fake placeholder numbers from index.html on screen
//   ['stat-conversations', 'stat-hot-leads', 'stat-converted', 'stat-revenue'].forEach(id => {
//     const el = document.getElementById(id);
//     if (el) el.innerText = '—';
//   });
// }

// async function crmFetchJson(url) {
//   const res = await fetch(url);

//   let data = null;

//   try {
//     data = await res.json();
//   } catch {
//     throw new Error(`${url} did not return JSON (HTTP ${res.status}). Are you still logged in?`);
//   }

//   if (!res.ok || !data.success) {
//     throw new Error(data.error || data.message || `${url} failed (HTTP ${res.status})`);
//   }

//   return data;
// }

// async function loadCRMView() {
//   try {
//     // 1. High level analytics
//     const analyticsData = await crmFetchJson('/api/leads/analytics');
//     const a = analyticsData.analytics;

//     document.getElementById('stat-conversations').innerText = a.totalConversations;
//     document.getElementById('stat-hot-leads').innerText = a.hotLeads;
//     document.getElementById('stat-converted').innerText = a.convertedLeads;
//     document.getElementById('stat-revenue').innerText = a.totalRevenue;

//     // 2. Leads list
//     const leadsData = await crmFetchJson('/api/leads/leads');
//     renderCRMTable(leadsData.leads);
//   } catch (err) {
//     console.error('Failed to load CRM:', err);
//     crmShowError(err.message);
//   }
// }

// function renderCRMTable(leads) {
//   const tbody = document.getElementById('crm-leads-table-body');
//   if (!tbody) return;

//   if (!leads || leads.length === 0) {
//     tbody.innerHTML =
//       '<tr><td colspan="7" style="text-align: center; color: #888;">No leads generated yet. Run a chat in the simulator!</td></tr>';
//     return;
//   }

//   tbody.innerHTML = leads
//     .map(l => {
//       const formattedDate = new Date(l.created_at).toLocaleString([], {
//         month: 'short',
//         day: 'numeric',
//         hour: '2-digit',
//         minute: '2-digit'
//       });

//       const intent = l.intent_score || 'WARM';
//       const isHot = intent === 'HOT';
//       const isConverted = ['CHECKOUT_CLICKED', 'ORDER_REQUESTED', 'PURCHASED'].includes(l.status);
//       const isClothing = (l.store_type || l.store_id) === 'clothing';
//       const value = Number(l.cart_value) || 0;

//       return `
//       <tr>
//         <td>
//           <div style="font-weight: 700; color: #fff;">${crmEsc(l.customer_handle || '@shopper')}</div>
//           <div style="font-size: 0.72rem; color: #64748b;">${crmEsc(l.customer_name || 'Customer')}</div>
//         </td>
//         <td>
//           <span style="font-size: 0.75rem; text-transform: uppercase; color: ${isClothing ? '#f472b6' : '#60a5fa'}; font-weight: 700;">
//             ${isClothing ? '👗 Clothing' : '⚡ Tech'}
//           </span>
//         </td>
//         <td>
//           <span style="color: #cbd5e1; font-size: 0.8rem;">${crmEsc(l.interested_product || 'Pending selection')}</span>
//         </td>
//         <td>
//           <strong style="color: #34d399;">₹${value.toLocaleString('en-IN')}</strong>
//         </td>
//         <td>
//           <span class="intent-badge intent-${crmEsc(intent)}">
//             ${isHot ? '🔥' : '⚡'} ${crmEsc(intent)}
//           </span>
//         </td>
//         <td>
//           <span style="font-size: 0.75rem; padding: 3px 8px; border-radius: 6px; font-weight: 700; background: ${isConverted ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.15)'}; color: ${isConverted ? '#34d399' : '#60a5fa'};">
//             ${crmEsc(l.status)}
//           </span>
//         </td>
//         <td style="color: #64748b; font-size: 0.75rem;">
//           ${crmEsc(formattedDate)}
//         </td>
//       </tr>
//     `;
//     })
//     .join('');
// }

// // Reload every time the CRM tab is opened (safe even if simulator.js already does this)
// document.querySelector('.tab-btn[data-tab="crm"]')?.addEventListener('click', loadCRMView);



// function crmEsc(value) {
//   if (value === null || value === undefined) return '';

//   return String(value)
//     .replace(/&/g, '&amp;')
//     .replace(/</g, '&lt;')
//     .replace(/>/g, '&gt;')
//     .replace(/"/g, '&quot;')
//     .replace(/'/g, '&#039;');
// }

// function crmShowError(message) {
//   const tbody = document.getElementById('crm-leads-table-body');

//   if (tbody) {
//     tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#f87171;">Could not load leads: ${crmEsc(message)}</td></tr>`;
//   }

//   // Do not leave the fake placeholder numbers from index.html on screen
//   ['stat-conversations', 'stat-hot-leads', 'stat-converted', 'stat-revenue'].forEach(id => {
//     const el = document.getElementById(id);
//     if (el) el.innerText = '—';
//   });
// }

// async function crmFetchJson(url) {
//   const res = await fetch(url);

//   let data = null;

//   try {
//     data = await res.json();
//   } catch {
//     throw new Error(`${url} did not return JSON (HTTP ${res.status}). Are you still logged in?`);
//   }

//   if (!res.ok || !data.success) {
//     throw new Error(data.error || data.message || `${url} failed (HTTP ${res.status})`);
//   }

//   return data;
// }

// async function loadCRMView() {
//   try {
//     // 1. High level analytics
//     const analyticsData = await crmFetchJson('/api/leads/analytics');
//     const a = analyticsData.analytics;

//     document.getElementById('stat-conversations').innerText = a.totalConversations;
//     document.getElementById('stat-hot-leads').innerText = a.hotLeads;
//     document.getElementById('stat-converted').innerText = a.convertedLeads;
//     document.getElementById('stat-revenue').innerText = a.totalRevenue;

//     // 2. Leads list
//     const leadsData = await crmFetchJson('/api/leads/leads');
//     renderCRMTable(leadsData.leads);
//   } catch (err) {
//     console.error('Failed to load CRM:', err);
//     crmShowError(err.message);
//   }
// }

// function renderCRMTable(leads) {
//   const tbody = document.getElementById('crm-leads-table-body');
//   if (!tbody) return;

//   if (!leads || leads.length === 0) {
//     tbody.innerHTML =
//       '<tr><td colspan="7" style="text-align: center; color: #888;">No leads generated yet. Run a chat in the simulator!</td></tr>';
//     return;
//   }

//   tbody.innerHTML = leads
//     .map(l => {
//       const formattedDate = new Date(l.created_at).toLocaleString([], {
//         month: 'short',
//         day: 'numeric',
//         hour: '2-digit',
//         minute: '2-digit'
//       });

//       const intent = l.intent_score || 'WARM';
//       const isHot = intent === 'HOT';
//       const isConverted = ['CHECKOUT_CLICKED', 'ORDER_REQUESTED', 'PURCHASED'].includes(l.status);
//       const isClothing = (l.store_type || l.store_id) === 'clothing';
//       const value = Number(l.cart_value) || 0;

//       return `
//       <tr>
//         <td>
//           <div style="font-weight: 700; color: #fff;">${crmEsc(l.customer_handle || '@shopper')}</div>
//           <div style="font-size: 0.72rem; color: #64748b;">${crmEsc(l.customer_name || 'Customer')}</div>
//         </td>
//         <td>
//           <span style="font-size: 0.75rem; text-transform: uppercase; color: ${isClothing ? '#f472b6' : '#60a5fa'}; font-weight: 700;">
//             ${isClothing ? '👗 Clothing' : '⚡ Tech'}
//           </span>
//         </td>
//         <td>
//           <span style="color: #cbd5e1; font-size: 0.8rem;">${crmEsc(l.interested_product || 'Pending selection')}</span>
//         </td>
//         <td>
//           <strong style="color: #34d399;">₹${value.toLocaleString('en-IN')}</strong>
//         </td>
//         <td>
//           <span class="intent-badge intent-${crmEsc(intent)}">
//             ${isHot ? '🔥' : '⚡'} ${crmEsc(intent)}
//           </span>
//         </td>
//         <td>
//           <span style="font-size: 0.75rem; padding: 3px 8px; border-radius: 6px; font-weight: 700; background: ${isConverted ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.15)'}; color: ${isConverted ? '#34d399' : '#60a5fa'};">
//             ${crmEsc(l.status)}
//           </span>
//         </td>
//         <td style="color: #64748b; font-size: 0.75rem;">
//           ${crmEsc(formattedDate)}
//         </td>
//       </tr>
//     `;
//     })
//     .join('');
// }

// // Reload every time the CRM tab is opened (safe even if simulator.js already does this)
// document.querySelector('.tab-btn[data-tab="crm"]')?.addEventListener('click', loadCRMView);


// //12/10
// // function crmEsc(value) {
// //   if (value === null || value === undefined) return '';

// //   return String(value)
// //     .replace(/&/g, '&amp;')
// //     .replace(/</g, '&lt;')
// //     .replace(/>/g, '&gt;')
// //     .replace(/"/g, '&quot;')
// //     .replace(/'/g, '&#039;');
// // }

// // function crmShowError(message) {
// //   const tbody = document.getElementById('crm-leads-table-body');

// //   if (tbody) {
// //     tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#f87171;">Could not load leads: ${crmEsc(message)}</td></tr>`;
// //   }

// //   // Do not leave the fake placeholder numbers from index.html on screen
// //   ['stat-conversations', 'stat-hot-leads', 'stat-converted', 'stat-revenue'].forEach(id => {
// //     const el = document.getElementById(id);
// //     if (el) el.innerText = '—';
// //   });
// // }

// // async function crmFetchJson(url) {
// //   const res = await fetch(url);

// //   let data = null;

// //   try {
// //     data = await res.json();
// //   } catch {
// //     throw new Error(`${url} did not return JSON (HTTP ${res.status}). Are you still logged in?`);
// //   }

// //   if (!res.ok || !data.success) {
// //     throw new Error(data.error || data.message || `${url} failed (HTTP ${res.status})`);
// //   }

// //   return data;
// // }

// // async function loadCRMView() {
// //   try {
// //     // 1. High level analytics
// //     const analyticsData = await crmFetchJson('/api/leads/analytics');
// //     const a = analyticsData.analytics;

// //     document.getElementById('stat-conversations').innerText = a.totalConversations;
// //     document.getElementById('stat-hot-leads').innerText = a.hotLeads;
// //     document.getElementById('stat-converted').innerText = a.convertedLeads;
// //     document.getElementById('stat-revenue').innerText = a.totalRevenue;

// //     // 2. Leads list
// //     const leadsData = await crmFetchJson('/api/leads/leads');
// //     renderCRMTable(leadsData.leads);
// //   } catch (err) {
// //     console.error('Failed to load CRM:', err);
// //     crmShowError(err.message);
// //   }
// // }

// // function renderCRMTable(leads) {
// //   const tbody = document.getElementById('crm-leads-table-body');
// //   if (!tbody) return;

// //   if (!leads || leads.length === 0) {
// //     tbody.innerHTML =
// //       '<tr><td colspan="7" style="text-align: center; color: #888;">No leads generated yet. Run a chat in the simulator!</td></tr>';
// //     return;
// //   }

// //   tbody.innerHTML = leads
// //     .map(l => {
// //       const formattedDate = new Date(l.created_at).toLocaleString([], {
// //         month: 'short',
// //         day: 'numeric',
// //         hour: '2-digit',
// //         minute: '2-digit'
// //       });

// //       const intent = l.intent_score || 'WARM';
// //       const isHot = intent === 'HOT';
// //       const isConverted = ['CHECKOUT_CLICKED', 'ORDER_REQUESTED', 'PURCHASED'].includes(l.status);
// //       const isClothing = (l.store_type || l.store_id) === 'clothing';
// //       const value = Number(l.cart_value) || 0;

// //       return `
// //       <tr>
// //         <td>
// //           <div style="font-weight: 700; color: #fff;">${crmEsc(l.customer_handle || '@shopper')}</div>
// //           <div style="font-size: 0.72rem; color: #64748b;">${crmEsc(l.customer_name || 'Customer')}</div>
// //         </td>
// //         <td>
// //           <span style="font-size: 0.75rem; text-transform: uppercase; color: ${isClothing ? '#f472b6' : '#60a5fa'}; font-weight: 700;">
// //             ${isClothing ? '👗 Clothing' : '⚡ Tech'}
// //           </span>
// //         </td>
// //         <td>
// //           <span style="color: #cbd5e1; font-size: 0.8rem;">${crmEsc(l.interested_product || 'Pending selection')}</span>
// //         </td>
// //         <td>
// //           <strong style="color: #34d399;">₹${value.toLocaleString('en-IN')}</strong>
// //         </td>
// //         <td>
// //           <span class="intent-badge intent-${crmEsc(intent)}">
// //             ${isHot ? '🔥' : '⚡'} ${crmEsc(intent)}
// //           </span>
// //         </td>
// //         <td>
// //           <span style="font-size: 0.75rem; padding: 3px 8px; border-radius: 6px; font-weight: 700; background: ${isConverted ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.15)'}; color: ${isConverted ? '#34d399' : '#60a5fa'};">
// //             ${crmEsc(l.status)}
// //           </span>
// //         </td>
// //         <td style="color: #64748b; font-size: 0.75rem;">
// //           ${crmEsc(formattedDate)}
// //         </td>
// //       </tr>
// //     `;
// //     })
// //     .join('');
// // }

// // // Reload every time the CRM tab is opened (safe even if simulator.js already does this)
// // document.querySelector('.tab-btn[data-tab="crm"]')?.addEventListener('click', loadCRMView);

// //old file
// // async function loadCRMView() {
// //   try {
// //     // 1. Fetch High Level Analytics
// //     const analyticsRes = await fetch('/api/leads/analytics');
// //     const analyticsData = await analyticsRes.json();
// //     if (analyticsData.success) {
// //       const a = analyticsData.analytics;
// //       document.getElementById('stat-conversations').innerText = a.totalConversations;
// //       document.getElementById('stat-hot-leads').innerText = a.hotLeads;
// //       document.getElementById('stat-converted').innerText = a.convertedLeads;
// //       document.getElementById('stat-revenue').innerText = a.totalRevenue;
// //     }

// //     // 2. Fetch Leads List
// //     const leadsRes = await fetch('/api/leads/leads');
// //     const leadsData = await leadsRes.json();
// //     if (leadsData.success) {
// //       renderCRMTable(leadsData.leads);
// //     }
// //   } catch (err) {
// //     console.error('Failed to load CRM:', err);
// //   }
// // }

// // function renderCRMTable(leads) {
// //   const tbody = document.getElementById('crm-leads-table-body');
// //   if (!leads || leads.length === 0) {
// //     tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #888;">No leads generated yet. Run a chat in the simulator!</td></tr>';
// //     return;
// //   }

// //   tbody.innerHTML = leads.map(l => {
// //     const formattedDate = new Date(l.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
// //     const isHot = l.intent_score === 'HOT';
// //     const isConverted = l.status === 'CHECKOUT_CLICKED' || l.status === 'PURCHASED';

// //     return `
// //       <tr>
// //         <td>
// //           <div style="font-weight: 700; color: #fff;">${l.customer_handle || '@shopper'}</div>
// //           <div style="font-size: 0.72rem; color: #64748b;">${l.customer_name || 'Instagram User'}</div>
// //         </td>
// //         <td>
// //           <span style="font-size: 0.75rem; text-transform: uppercase; color: ${l.store_type === 'clothing' ? '#f472b6' : '#60a5fa'}; font-weight: 700;">
// //             ${l.store_type === 'clothing' ? '👗 Clothing' : '⚡ Tech'}
// //           </span>
// //         </td>
// //         <td>
// //           <span style="color: #cbd5e1; font-size: 0.8rem;">${l.interested_product || 'Pending selection'}</span>
// //         </td>
// //         <td>
// //           <strong style="color: #34d399;">$${l.cart_value || '0.00'}</strong>
// //         </td>
// //         <td>
// //           <span class="intent-badge intent-${l.intent_score}">
// //             ${isHot ? '🔥' : '⚡'} ${l.intent_score}
// //           </span>
// //         </td>
// //         <td>
// //           <span style="font-size: 0.75rem; padding: 3px 8px; border-radius: 6px; font-weight: 700; background: ${isConverted ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.15)'}; color: ${isConverted ? '#34d399' : '#60a5fa'};">
// //             ${l.status}
// //           </span>
// //         </td>
// //         <td style="color: #64748b; font-size: 0.75rem;">
// //           ${formattedDate}
// //         </td>
// //       </tr>
// //     `;
// //   }).join('');
// // }
