//15/10
/* CONNECT WHATSAPP (Embedded Signup) + health check + test message */

(function () {
  'use strict';

  const ES_ORIGINS = ['https://www.facebook.com', 'https://web.facebook.com', 'https://business.facebook.com'];

  let cfg = null;
  let sdkReady = false;
  let pending = null; // { code, session }
  let pendingTimer = null;

  function el(id) {
    return document.getElementById(id);
  }

  function storeId() {
    return el('wa-connect-store')?.value || el('catalog-store-filter')?.value || 'clothing';
  }

  function say(text, ok) {
    const node = el('wa-connect-msg');
    if (!node) return;

    node.style.color = ok ? '#34d399' : '#f87171';
    node.textContent = text || '';
  }

  function setBusy(busy) {
    const button = el('wa-connect-btn');
    if (button) button.disabled = busy || !sdkReady;
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: { 'x-store-id': storeId(), ...(options.headers || {}) }
    });

    if (res.redirected && /login/i.test(res.url)) throw new Error('Your session expired. Please log in again.');

    let data = null;

    try {
      data = await res.json();
    } catch {
      throw new Error(`The server sent a web page instead of data (HTTP ${res.status}). Restart the server and refresh.`);
    }

    if (!res.ok || !data.success) {
      throw new Error(`${data.error || data.message || 'HTTP ' + res.status}${data.hint ? ' - ' + data.hint : ''}`);
    }

    return data;
  }

  /* ---------- status ---------- */

  async function refreshStatus() {
    const node = el('wa-connect-status');
    const disconnect = el('wa-disconnect-btn');
    if (!node) return;

    try {
      const data = await api(`/api/whatsapp-onboard/status?store_id=${encodeURIComponent(storeId())}`);
      const s = data.status;

      if (s.connected) {
        node.style.color = '#34d399';
        node.textContent =
          `✅ Connected${s.whatsapp_number ? ': +' + s.whatsapp_number : ''}` +
          `${s.verified_name ? ' (' + s.verified_name + ')' : ''}` +
          `${s.via === 'embedded_signup' ? ' via 1-click signup' : ' (manual setup)'}`;
        if (disconnect) disconnect.style.display = 'inline-flex';
      } else {
        node.style.color = '#94a3b8';
        node.textContent = 'Not connected yet.';
        if (disconnect) disconnect.style.display = 'none';
      }
    } catch (error) {
      node.style.color = '#f87171';
      node.textContent = `Could not read status: ${error.message}`;
    }
  }

  /* ---------- health check + test message ---------- */

  async function waHealth() {
    const out = el('wa-health-out');
    if (!out) return;

    out.style.color = '#94a3b8';
    out.textContent = 'Checking...';

    try {
      const data = await api(`/api/whatsapp-onboard/health?store_id=${encodeURIComponent(storeId())}`);

      out.style.color = '#cbd5e1';
      out.textContent =
        (data.all_ok ? '✅ Everything looks good\n\n' : '⚠️ Something needs attention\n\n') +
        data.checks.map(c => `${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? '\n     ' + c.detail : ''}`).join('\n');
    } catch (error) {
      out.style.color = '#f87171';
      out.textContent = `Health check failed: ${error.message}`;
    }
  }

  async function waTestSend() {
    const to = (el('wa-test-to')?.value || '').trim();

    if (!to) {
      say('Type your phone number first (country code + number).', false);
      return;
    }

    say('Sending test message...', true);

    try {
      await api('/api/whatsapp-onboard/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: storeId(), to })
      });

      say('Test message sent. Check your WhatsApp.', true);
    } catch (error) {
      say(`Test failed: ${error.message}`, false);
    }
  }

  /* ---------- Facebook SDK ---------- */

  function loadSdk(appId, version) {
    return new Promise((resolve, reject) => {
      if (window.FB) {
        window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
        return resolve();
      }

      window.fbAsyncInit = function () {
        window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
        resolve();
      };

      const script = document.createElement('script');
      script.src = 'https://connect.facebook.net/en_US/sdk.js';
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      script.onerror = () => reject(new Error('Could not load the Facebook SDK (an ad blocker may be blocking it)'));

      document.head.appendChild(script);
    });
  }

  /* ---------- finishing the signup ---------- */

  function clearPending() {
    pending = null;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  async function tryComplete() {
    if (!pending || !pending.code || !pending.session) return;

    const { code, session } = pending;

    if (!session.phone_number_id || !session.waba_id) {
      clearPending();
      setBusy(false);
      say('The signup finished without a phone number. Please run it again and add a phone number.', false);
      return;
    }

    clearPending();
    say('Finishing setup (registering the number and connecting messages)...', true);

    try {
      const data = await api('/api/whatsapp-onboard/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: storeId(),
          code,
          waba_id: session.waba_id,
          phone_number_id: session.phone_number_id,
          business_id: session.business_id || null
        })
      });

      say(`WhatsApp connected! ${data.next || ''}`, true);
      refreshStatus();
      waHealth();
    } catch (error) {
      say(`Setup failed: ${error.message}`, false);
    } finally {
      setBusy(false);
    }
  }

  window.addEventListener('message', function (event) {
    console.log('FB message', event.origin, event.data);
    if (!ES_ORIGINS.includes(event.origin)) return;

    let data = event.data;

    try {
      if (typeof data === 'string') data = JSON.parse(data);
    } catch {
      return;
    }

    if (!data || data.type !== 'WA_EMBEDDED_SIGNUP') return;
    if (!pending) return;

    const name = String(data.event || '');

    if (name.startsWith('FINISH')) {
      pending.session = data.data || {};
      tryComplete();
    } else if (name === 'CANCEL') {
      clearPending();
      setBusy(false);
      say('Signup was cancelled.', false);
    } else if (name === 'ERROR') {
      clearPending();
      setBusy(false);
      say(`Meta reported an error: ${data.data?.error_message || 'please try again'}`, false);
    }
  });

  /* ---------- public actions ---------- */

  function startWhatsAppSignup() {
    if (!sdkReady || !window.FB || !cfg) {
      say('Embedded Signup is not ready yet.', false);
      return;
    }

    clearPending();
    pending = { code: null, session: null };

    setBusy(true);
    say('Opening the Meta sign-in window...', true);

    window.FB.login(
      function (response) {
        if (response && response.authResponse && response.authResponse.code) {
          pending = pending || { code: null, session: null };
          pending.code = response.authResponse.code;

          pendingTimer = setTimeout(() => {
            if (pending) {
              clearPending();
              setBusy(false);
              say('Meta did not send the WhatsApp details in time. Please try again.', false);
            }
          }, 60000);

          tryComplete();
        } else {
          clearPending();
          setBusy(false);
          say('Sign-in was cancelled or not authorised.', false);
        }
      },
      {
        config_id: cfg.config_id,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, sessionInfoVersion: '3' }
      }
    );
  }

  async function disconnectWhatsApp() {
    if (!confirm('Disconnect WhatsApp for this business? The bot will stop replying on WhatsApp until it is connected again.')) return;

    try {
      await api('/api/whatsapp-onboard/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: storeId() })
      });

      say('Disconnected.', true);
      refreshStatus();
    } catch (error) {
      say(`Could not disconnect: ${error.message}`, false);
    }
  }

  window.startWhatsAppSignup = startWhatsAppSignup;
  window.disconnectWhatsApp = disconnectWhatsApp;
  window.waConnectRefresh = refreshStatus;
  window.waHealth = waHealth;
  window.waTestSend = waTestSend;

  /* ---------- start ---------- */

  async function init() {
    if (!el('wa-connect-card')) return;

    refreshStatus();

    document.querySelector('.tab-btn[data-tab="setup"]')?.addEventListener('click', refreshStatus);

    try {
      const data = await api('/api/whatsapp-onboard/config');

      cfg = data;

      if (!data.enabled) {
        say(
          '1-click signup is switched off. It turns on when META_APP_ID, META_APP_SECRET and WHATSAPP_ES_CONFIG_ID are set in .env.',
          false
        );
        return;
      }

      await loadSdk(data.app_id, data.graph_version || 'v23.0');

      sdkReady = true;
      setBusy(false);
    } catch (error) {
      say(`1-click signup unavailable: ${error.message}`, false);
    }
  }

  init();
})();



// //13/10

// /* ============================================================
//  * CONNECT WHATSAPP (Embedded Signup) - dashboard card in the Setup tab
//  * Needs: GET /api/whatsapp-onboard/config, /status, POST /complete, /disconnect
//  *
//  * Safe by design: if Embedded Signup is not configured on the server,
//  * nothing is loaded and the button stays disabled.
//  * ============================================================ */

// (function () {
//   'use strict';

//   const ES_ORIGINS = ['https://www.facebook.com', 'https://web.facebook.com', 'https://business.facebook.com'];

//   let cfg = null;
//   let sdkReady = false;
//   let pending = null; // { code, session }
//   let pendingTimer = null;

//   function el(id) {
//     return document.getElementById(id);
//   }

//   function storeId() {
//     return el('wa-connect-store')?.value || el('catalog-store-filter')?.value || 'clothing';
//   }

//   function say(text, ok) {
//     const node = el('wa-connect-msg');
//     if (!node) return;

//     node.style.color = ok ? '#34d399' : '#f87171';
//     node.textContent = text || '';
//   }

//   function setBusy(busy) {
//     const button = el('wa-connect-btn');
//     if (button) button.disabled = busy || !sdkReady;
//   }

//   // Every request goes through here so errors are always readable
//   async function api(url, options = {}) {
//     const res = await fetch(url, {
//       credentials: 'same-origin',
//       ...options,
//       headers: { 'x-store-id': storeId(), ...(options.headers || {}) }
//     });

//     if (res.redirected && /login/i.test(res.url)) throw new Error('Your session expired. Please log in again.');

//     let data = null;

//     try {
//       data = await res.json();
//     } catch {
//       throw new Error(`The server sent a web page instead of data (HTTP ${res.status}). Restart the server and refresh.`);
//     }

//     if (!res.ok || !data.success) {
//       // your login middleware answers with "message", other routes with "error"
//       throw new Error(`${data.error || data.message || 'HTTP ' + res.status}${data.hint ? ' - ' + data.hint : ''}`);
//     }

//     return data;
//   }

//   /* ---------- status ---------- */

//   async function refreshStatus() {
//     const node = el('wa-connect-status');
//     const disconnect = el('wa-disconnect-btn');
//     if (!node) return;

//     try {
//       const data = await api(`/api/whatsapp-onboard/status?store_id=${encodeURIComponent(storeId())}`);
//       const s = data.status;

//       if (s.connected) {
//         node.style.color = '#34d399';
//         node.textContent =
//           `✅ Connected${s.whatsapp_number ? ': +' + s.whatsapp_number : ''}` +
//           `${s.verified_name ? ' (' + s.verified_name + ')' : ''}` +
//           `${s.via === 'embedded_signup' ? ' via 1-click signup' : ' (manual setup)'}`;
//         if (disconnect) disconnect.style.display = 'inline-flex';
//       } else {
//         node.style.color = '#94a3b8';
//         node.textContent = 'Not connected yet.';
//         if (disconnect) disconnect.style.display = 'none';
//       }
//     } catch (error) {
//       node.style.color = '#f87171';
//       node.textContent = `Could not read status: ${error.message}`;
//     }
//   }

//   /* ---------- Facebook SDK (loaded only when enabled) ---------- */

//   function loadSdk(appId, version) {
//     return new Promise((resolve, reject) => {
//       if (window.FB) {
//         window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
//         return resolve();
//       }

//       window.fbAsyncInit = function () {
//         window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
//         resolve();
//       };

//       const script = document.createElement('script');
//       script.src = 'https://connect.facebook.net/en_US/sdk.js';
//       script.async = true;
//       script.defer = true;
//       script.crossOrigin = 'anonymous';
//       script.onerror = () => reject(new Error('Could not load the Facebook SDK (an ad blocker may be blocking it)'));

//       document.head.appendChild(script);
//     });
//   }

//   /* ---------- finishing the signup ---------- */

//   function clearPending() {
//     pending = null;
//     if (pendingTimer) clearTimeout(pendingTimer);
//     pendingTimer = null;
//   }

//   async function tryComplete() {
//     if (!pending || !pending.code || !pending.session) return;

//     const { code, session } = pending;

//     if (!session.phone_number_id || !session.waba_id) {
//       clearPending();
//       setBusy(false);
//       say('The signup finished without a phone number. Please run it again and add a phone number.', false);
//       return;
//     }

//     clearPending();
//     say('Finishing setup (registering the number and connecting messages)...', true);

//     try {
//       const data = await api('/api/whatsapp-onboard/complete', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({
//           store_id: storeId(),
//           code,
//           waba_id: session.waba_id,
//           phone_number_id: session.phone_number_id,
//           business_id: session.business_id || null
//         })
//       });

//       say(`WhatsApp connected! ${data.next || ''}`, true);
//       refreshStatus();
//     } catch (error) {
//       say(`Setup failed: ${error.message}`, false);
//     } finally {
//       setBusy(false);
//     }
//   }

//   window.addEventListener('message', function (event) {
//     if (!ES_ORIGINS.includes(event.origin)) return;

//     let data = event.data;

//     try {
//       if (typeof data === 'string') data = JSON.parse(data);
//     } catch {
//       return;
//     }

//     if (!data || data.type !== 'WA_EMBEDDED_SIGNUP') return;

//     // Ignore messages when the person did not press the Connect button
//     if (!pending) return;

//     const name = String(data.event || '');

//     if (name.startsWith('FINISH')) {
//       pending.session = data.data || {};
//       tryComplete();
//     } else if (name === 'CANCEL') {
//       clearPending();
//       setBusy(false);
//       say('Signup was cancelled.', false);
//     } else if (name === 'ERROR') {
//       clearPending();
//       setBusy(false);
//       say(`Meta reported an error: ${data.data?.error_message || 'please try again'}`, false);
//     }
//   });

//   /* ---------- public actions ---------- */

//   function startWhatsAppSignup() {
//     if (!sdkReady || !window.FB || !cfg) {
//       say('Embedded Signup is not ready yet.', false);
//       return;
//     }

//     clearPending();
//     pending = { code: null, session: null };

//     setBusy(true);
//     say('Opening the Meta sign-in window...', true);

//     window.FB.login(
//       function (response) {
//         if (response && response.authResponse && response.authResponse.code) {
//           pending = pending || { code: null, session: null };
//           pending.code = response.authResponse.code;

//           // the asset ids arrive as a separate message; give it up to 60 seconds
//           pendingTimer = setTimeout(() => {
//             if (pending) {
//               clearPending();
//               setBusy(false);
//               say('Meta did not send the WhatsApp details in time. Please try again.', false);
//             }
//           }, 60000);

//           tryComplete();
//         } else {
//           clearPending();
//           setBusy(false);
//           say('Sign-in was cancelled or not authorised.', false);
//         }
//       },
//       {
//         config_id: cfg.config_id,
//         response_type: 'code',
//         override_default_response_type: true,
//         extras: { setup: {}, sessionInfoVersion: '3' }
//       }
//     );
//   }

//   async function disconnectWhatsApp() {
//     if (!confirm('Disconnect WhatsApp for this business? The bot will stop replying on WhatsApp until it is connected again.')) return;

//     try {
//       await api('/api/whatsapp-onboard/disconnect', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ store_id: storeId() })
//       });

//       say('Disconnected.', true);
//       refreshStatus();
//     } catch (error) {
//       say(`Could not disconnect: ${error.message}`, false);
//     }
//   }

//   window.startWhatsAppSignup = startWhatsAppSignup;
//   window.disconnectWhatsApp = disconnectWhatsApp;
//   window.waConnectRefresh = refreshStatus;

//   /* ---------- start ---------- */

//   async function init() {
//     if (!el('wa-connect-card')) return;

//     refreshStatus();

//     // re-read the status whenever the Setup tab is opened
//     document.querySelector('.tab-btn[data-tab="setup"]')?.addEventListener('click', refreshStatus);

//     try {
//       const data = await api('/api/whatsapp-onboard/config');

//       cfg = data;

//       if (!data.enabled) {
//         say(
//           '1-click signup is switched off. It turns on when META_APP_ID, META_APP_SECRET and WHATSAPP_ES_CONFIG_ID are set in .env.',
//           false
//         );
//         return;
//       }

//       await loadSdk(data.app_id, data.graph_version || 'v23.0');

//       sdkReady = true;
//       setBusy(false);
//     } catch (error) {
//       say(`1-click signup unavailable: ${error.message}`, false);
//     }
//   }

//   init();
// })();

//old file
// /* ============================================================
//  * CONNECT WHATSAPP (Embedded Signup) - dashboard card in the Setup tab
//  * Needs: GET /api/whatsapp-onboard/config, /status, POST /complete, /disconnect
//  *
//  * Safe by design: if Embedded Signup is not configured on the server,
//  * nothing is loaded and the button stays disabled.
//  * ============================================================ */

// (function () {
//   'use strict';

//   const ES_ORIGINS = ['https://www.facebook.com', 'https://web.facebook.com', 'https://business.facebook.com'];

//   let cfg = null;
//   let sdkReady = false;
//   let pending = null; // { code, session }
//   let pendingTimer = null;

//   function el(id) {
//     return document.getElementById(id);
//   }

//   function storeId() {
//     return el('wa-connect-store')?.value || 'clothing';
//   }

//   function say(text, ok) {
//     const node = el('wa-connect-msg');
//     if (!node) return;

//     node.style.color = ok ? '#34d399' : '#f87171';
//     node.textContent = text || '';
//   }

//   function setBusy(busy) {
//     const button = el('wa-connect-btn');
//     if (button) button.disabled = busy || !sdkReady;
//   }

//   /* ---------- status ---------- */

//   async function refreshStatus() {
//     const node = el('wa-connect-status');
//     const disconnect = el('wa-disconnect-btn');
//     if (!node) return;

//     try {
//       const res = await fetch(`/api/whatsapp-onboard/status?store_id=${encodeURIComponent(storeId())}`);
//       const data = await res.json();

//       if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);

//       const s = data.status;

//       if (s.connected) {
//         node.style.color = '#34d399';
//         node.textContent =
//           `✅ Connected${s.whatsapp_number ? ': +' + s.whatsapp_number : ''}` +
//           `${s.verified_name ? ' (' + s.verified_name + ')' : ''}` +
//           `${s.via === 'embedded_signup' ? ' via 1-click signup' : ' (manual setup)'}`;
//         if (disconnect) disconnect.style.display = 'inline-flex';
//       } else {
//         node.style.color = '#94a3b8';
//         node.textContent = 'Not connected yet.';
//         if (disconnect) disconnect.style.display = 'none';
//       }
//     } catch (error) {
//       node.style.color = '#f87171';
//       node.textContent = `Could not read status: ${error.message}`;
//     }
//   }

//   /* ---------- Facebook SDK (loaded only when enabled) ---------- */

//   function loadSdk(appId, version) {
//     return new Promise((resolve, reject) => {
//       if (window.FB) {
//         window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
//         return resolve();
//       }

//       window.fbAsyncInit = function () {
//         window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
//         resolve();
//       };

//       const script = document.createElement('script');
//       script.src = 'https://connect.facebook.net/en_US/sdk.js';
//       script.async = true;
//       script.defer = true;
//       script.crossOrigin = 'anonymous';
//       script.onerror = () => reject(new Error('Could not load the Facebook SDK (an ad blocker may be blocking it)'));

//       document.head.appendChild(script);
//     });
//   }

//   /* ---------- finishing the signup ---------- */

//   function clearPending() {
//     pending = null;
//     if (pendingTimer) clearTimeout(pendingTimer);
//     pendingTimer = null;
//   }

//   async function tryComplete() {
//     if (!pending || !pending.code || !pending.session) return;

//     const { code, session } = pending;

//     if (!session.phone_number_id || !session.waba_id) {
//       clearPending();
//       setBusy(false);
//       say('The signup finished without a phone number. Please run it again and add a phone number.', false);
//       return;
//     }

//     clearPending();
//     say('Finishing setup (registering the number and connecting messages)...', true);

//     try {
//       const res = await fetch('/api/whatsapp-onboard/complete', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({
//           store_id: storeId(),
//           code,
//           waba_id: session.waba_id,
//           phone_number_id: session.phone_number_id,
//           business_id: session.business_id || null
//         })
//       });

//       const data = await res.json().catch(() => ({}));

//       if (!res.ok || !data.success) {
//         throw new Error(`${data.error || 'HTTP ' + res.status}${data.hint ? ' - ' + data.hint : ''}`);
//       }

//       say(`WhatsApp connected! ${data.next || ''}`, true);
//       refreshStatus();
//     } catch (error) {
//       say(`Setup failed: ${error.message}`, false);
//     } finally {
//       setBusy(false);
//     }
//   }

//   window.addEventListener('message', function (event) {
//     if (!ES_ORIGINS.includes(event.origin)) return;

//     let data = event.data;

//     try {
//       if (typeof data === 'string') data = JSON.parse(data);
//     } catch {
//       return;
//     }

//     if (!data || data.type !== 'WA_EMBEDDED_SIGNUP') return;

//     const name = String(data.event || '');

//     if (name.startsWith('FINISH')) {
//       pending = pending || { code: null, session: null };
//       pending.session = data.data || {};
//       tryComplete();
//     } else if (name === 'CANCEL') {
//       clearPending();
//       setBusy(false);
//       say('Signup was cancelled.', false);
//     }
//   });

//   /* ---------- public actions ---------- */

//   function startWhatsAppSignup() {
//     if (!sdkReady || !window.FB || !cfg) {
//       say('Embedded Signup is not ready yet.', false);
//       return;
//     }

//     clearPending();
//     pending = { code: null, session: null };

//     setBusy(true);
//     say('Opening the Meta sign-in window...', true);

//     window.FB.login(
//       function (response) {
//         if (response && response.authResponse && response.authResponse.code) {
//           pending = pending || { code: null, session: null };
//           pending.code = response.authResponse.code;

//           // the asset ids arrive as a separate message; give it up to 60 seconds
//           pendingTimer = setTimeout(() => {
//             if (pending) {
//               clearPending();
//               setBusy(false);
//               say('Meta did not send the WhatsApp details in time. Please try again.', false);
//             }
//           }, 60000);

//           tryComplete();
//         } else {
//           clearPending();
//           setBusy(false);
//           say('Sign-in was cancelled or not authorised.', false);
//         }
//       },
//       {
//         config_id: cfg.config_id,
//         response_type: 'code',
//         override_default_response_type: true,
//         extras: { setup: {}, sessionInfoVersion: '3' }
//       }
//     );
//   }

//   async function disconnectWhatsApp() {
//     if (!confirm('Disconnect WhatsApp for this business? The bot will stop replying on WhatsApp until it is connected again.')) return;

//     try {
//       const res = await fetch('/api/whatsapp-onboard/disconnect', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ store_id: storeId() })
//       });

//       const data = await res.json().catch(() => ({}));

//       if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);

//       say('Disconnected.', true);
//       refreshStatus();
//     } catch (error) {
//       say(`Could not disconnect: ${error.message}`, false);
//     }
//   }

//   window.startWhatsAppSignup = startWhatsAppSignup;
//   window.disconnectWhatsApp = disconnectWhatsApp;
//   window.waConnectRefresh = refreshStatus;

//   /* ---------- start ---------- */

//   async function init() {
//     if (!el('wa-connect-card')) return;

//     refreshStatus();

//     try {
//       const res = await fetch('/api/whatsapp-onboard/config');
//       const data = await res.json();

//       if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);

//       cfg = data;

//       if (!data.enabled) {
//         say(
//           '1-click signup is switched off. It turns on when META_APP_ID, META_APP_SECRET and WHATSAPP_ES_CONFIG_ID are set in .env.',
//           false
//         );
//         return;
//       }

//       await loadSdk(data.app_id, data.graph_version || 'v23.0');

//       sdkReady = true;
//       setBusy(false);
//     } catch (error) {
//       say(`1-click signup unavailable: ${error.message}`, false);
//     }
//   }

//   init();
// })();