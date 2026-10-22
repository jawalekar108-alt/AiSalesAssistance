//18/10

let currentStore = 'clothing';
let currentSessionId = 'sim_session_' + Date.now();
let activeOrderProduct = null;
let currencySymbol = '₹';
let isAdminUser = true; // stays true if the server does not answer, so nothing disappears by mistake

function money(value) {
  const number = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(number)) return '';
  return `${currencySymbol}${number.toLocaleString('en-IN')}`;
}

const STORE_CONFIG = {
  clothing: {
    name: 'AURA Streetwear',
    avatar: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=120&fit=crop',
    promo: 'FLASH15 (15% OFF)',
    defaultCart: '₹0',
    ads: [
      { id: 'hoodie_sale_50', name: '🔥 50% Off CyberPunk Hoodie (480 GSM)' },
      { id: 'cargo_pants_viral', name: '👖 AeroFlex Techwear Cargo Pants Drop' },
      { id: 'heavyweight_tee', name: '👕 Minimalist 280 GSM Boxy Tee Bundle' }
    ]
  },
  electronics: {
    name: 'NEXUS Tech',
    avatar: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=120&fit=crop',
    promo: 'TECH10 (10% OFF)',
    defaultCart: '₹0',
    ads: [
      { id: 'anc_earbuds_deal', name: '🎧 NEXUS Pro -42dB ANC Earbuds Ad' },
      { id: 'smartwatch_deal', name: '⌚ TitanTrack Titanium 14-Day Watch Ad' },
      { id: 'magsafe_travel_charger', name: '🔋 3-in-1 Foldable MagSafe Station Ad' }
    ]
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();

  const me = await loadWhoAmI();
  await setupTenant(me);

  selectStore(currentStore);
  checkBotStatus();
});

// Who is logged in? (admin sees both demo stores, a business owner sees only their own)
async function loadWhoAmI() {
  try {
    const response = await fetch('/api/simulator/me', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    return data && data.success ? data : null;
  } catch (error) {
    console.warn('[Simulator] Could not load the logged-in user:', error.message);
    return null;
  }
}

function simEsc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function setupTenant(me) {
  if (!me || !me.store) return;

  currencySymbol = me.store.currency || '₹';
  isAdminUser = Boolean(me.isAdmin);

  // Admin / SaaS owner keeps the demo store switcher
  if (isAdminUser) return;

  const store = me.store;
  const name = store.business_name || store.name || 'My Store';

  // 1. Hide the store picker (and its heading)
  const group = document.querySelector('.store-radio-group');

  if (group) {
    const heading = group.previousElementSibling;
    if (heading && heading.classList.contains('section-label')) heading.style.display = 'none';
    group.style.display = 'none';
  }

  // 2. Hide the store dropdowns in the Catalog and Orders tabs, leaving only this store
  ['catalog-store-filter', 'orders-store-filter'].forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;

    select.innerHTML = `<option value="${simEsc(store.id)}">${simEsc(name)}</option>`;
    select.value = store.id;
    select.style.display = 'none';
  });

  // 3. Ad buttons come from this store's own products
  let ads = [];

  try {
    const response = await fetch(`/api/catalog/products?store_type=${encodeURIComponent(store.id)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'x-store-id': store.id }
    });

    const data = await response.json();

    ads = (data.products || []).slice(0, 3).map(product => ({
      id: String((product.ad_triggers && product.ad_triggers[0]) || product.id).replace(/["'\\]/g, ''),
      name: `📣 ${String(product.name || 'Product').replace(/["'\\]/g, '').slice(0, 40)} Ad`
    }));
  } catch (error) {
    console.warn('[Simulator] Could not load products for the ad buttons:', error.message);
  }

  if (!ads.length) ads = [{ id: 'instagram_ad', name: '📣 Instagram Ad' }];

  const pct = Number(store.promo_discount_percent) || 0;

  currentStore = store.id;

  STORE_CONFIG[store.id] = {
    name,
    avatar: STORE_CONFIG.clothing.avatar,
    promo: store.active_promo_code && pct > 0 ? `${store.active_promo_code} (${pct}% OFF)` : 'No active offer',
    defaultCart: money(0),
    ads
  };

  // 4. The other tabs were already loading with the demo store: reload them for this store
  if (typeof window.loadCatalogView === 'function') window.loadCatalogView();
  if (typeof window.loadMyProducts === 'function') window.loadMyProducts();
  if (typeof window.ordersStoreChanged === 'function') window.ordersStoreChanged();
  else if (typeof window.loadOrders === 'function') window.loadOrders();
}
// Check whether the application server is reachable. The /health endpoint
// exists in server.js and does not require simulator-specific backend routes.
async function checkBotStatus() {
  const statusEl =
    document.getElementById('bot-status-text') ||
    document.getElementById('bot-status') ||
    document.getElementById('simulator-status');

  try {
    const response = await fetch('/health', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`Health check returned HTTP ${response.status}`);
    }

    const data = await response.json();
    const online = data.success === true && data.status === 'online';

    if (statusEl) {
      statusEl.textContent = online ? 'Online' : 'Unavailable';
      statusEl.classList.toggle('online', online);
      statusEl.classList.toggle('offline', !online);
      statusEl.setAttribute('aria-live', 'polite');
    }

    if (!online) {
      console.warn('[Simulator] Server health check did not report online status.', data);
    }

    return online;
  } catch (error) {
    if (statusEl) {
      statusEl.textContent = 'Unavailable';
      statusEl.classList.remove('online');
      statusEl.classList.add('offline');
      statusEl.setAttribute('aria-live', 'polite');
    }

    console.warn('[Simulator] Could not check server status:', error.message);
    return false;
  }
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const tabId = btn.dataset.tab;
      document.getElementById(`tab-${tabId}`).classList.add('active');

      if (tabId === 'catalog') loadCatalogView();
      if (tabId === 'crm') loadCRMView();
    });
  });
}

function selectStore(storeType) {
  currentStore = storeType;
  
  document.querySelectorAll('.store-option').forEach(el => {
    el.classList.toggle('selected', el.dataset.store === storeType);
  });

  const cfg = STORE_CONFIG[storeType];
  document.getElementById('header-brand-name').innerHTML = `${cfg.name} <i class="fas fa-check-circle verified-icon"></i>`;
  document.getElementById('header-avatar').src = cfg.avatar;
  document.getElementById('active-promo-badge').innerText = cfg.promo;
  document.getElementById('lead-cart-value').innerText = cfg.defaultCart;

  const adContainer = document.getElementById('ad-buttons-container');
  adContainer.innerHTML = cfg.ads.map(ad => `
    <button class="btn btn-ig" onclick="simulateAdClick('${ad.id}', '${ad.name.replace(/'/g, "\\'")}')">
      <i class="fab fa-instagram"></i> ${ad.name}
    </button>
  `).join('');

  simulateAdClick(cfg.ads[0].id, cfg.ads[0].name);
}

async function simulateAdClick(adCampaignId, adName) {
  currentSessionId = `sim_${currentStore}_${Date.now()}`;
  const stream = document.getElementById('chat-messages-stream');
  stream.innerHTML = '<div style="text-align: center; font-size: 0.72rem; color: #666; margin: 0.4rem 0;">— Tapped Instagram Sponsored Ad (Click-to-DM) —</div>';

  try {
    const res = await fetch('/api/simulator/ad-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentSessionId,
        storeType: currentStore,
        adCampaignId,
        adName,
        customerHandle: '@shopper_vip'
      })
    });

    const data = await res.json();
    if (data.success) {
      appendBotMessage(data.botMessage);
      updateInspector(data.conversation);
    }
  } catch (err) {
    console.error('Ad click simulation error:', err);
  }
}

async function sendUserMessage(textOverride) {
  const input = document.getElementById('user-input-box');
  const text = textOverride || input.value.trim();
  if (!text) return;

  appendUserBubble(text);
  if (!textOverride) input.value = '';

  document.getElementById('quick-replies-container').innerHTML = '';
  const typingId = showTypingIndicator();

  try {
    const res = await fetch('/api/simulator/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentSessionId,
        userText: text,
        storeType: currentStore
      })
    });

    removeTypingIndicator(typingId);
    const data = await res.json();

    if (data.success) {
      appendBotMessage(data.botMessage);
      updateInspector(data.conversation, data.lead);
    }
  } catch (err) {
    removeTypingIndicator(typingId);
    console.error('Chat error:', err);
  }
}

function handleInputKey(e) {
  if (e.key === 'Enter') {
    sendUserMessage();
  }
}

// 1-Click Fast Checkout Simulator & Post-Purchase Trigger
function openCheckoutModal(productJson) {
  try {
    activeOrderProduct = typeof productJson === 'string' ? JSON.parse(decodeURIComponent(productJson)) : productJson;
  } catch (e) {
    activeOrderProduct = { name: 'CyberPunk Heavyweight Hoodie', price: 54.99 };
  }

  const modal = document.getElementById('checkout-modal');
  document.getElementById('chk-item-name').innerText = activeOrderProduct.name;
  document.getElementById('chk-item-price').innerText = money(activeOrderProduct.price);
  document.getElementById('chk-item-total').innerText = money(activeOrderProduct.price);
  modal.style.display = 'flex';
}

function closeCheckoutModal() {
  document.getElementById('checkout-modal').style.display = 'none';
}

async function completeSimulatedPayment() {
  closeCheckoutModal();
  const typingId = showTypingIndicator();

  try {
    const res = await fetch('/api/simulator/checkout-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentSessionId,
        storeType: currentStore,
        orderDetails: activeOrderProduct
      })
    });

    removeTypingIndicator(typingId);
    const data = await res.json();

    if (data.success) {
      // Append Receipt and Cross-Sell Sequence
      if (data.receiptMsg) appendBotMessage(data.receiptMsg);
      if (data.crossSellMsg) {
        setTimeout(() => {
          appendBotMessage(data.crossSellMsg);
        }, 1200);
      }

      // Update Inspector & Funnel to CONVERTED
      updateInspector({ stage: 'CLOSING', intent_score: 'HOT' }, data.lead);
    }
  } catch (err) {
    removeTypingIndicator(typingId);
    console.error('Checkout error:', err);
  }
}

async function triggerManualFollowUp(stage) {
  const typingId = showTypingIndicator();
  try {
    const res = await fetch('/api/simulator/trigger-followup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSessionId, stage })
    });
    removeTypingIndicator(typingId);
    const data = await res.json();
    if (data.success && data.latestMessage) {
      appendBotMessage(data.latestMessage);
    }
  } catch (err) {
    removeTypingIndicator(typingId);
    console.error('Follow-up error:', err);
  }
}

async function resetCurrentSession() {
  await fetch(`/api/simulator/reset/${currentSessionId}`, { method: 'POST' });
  selectStore(currentStore);
}

function appendUserBubble(text) {
  const stream = document.getElementById('chat-messages-stream');
  const div = document.createElement('div');
  div.className = 'msg-bubble msg-user';
  div.innerText = text;
  stream.appendChild(div);
  stream.scrollTop = stream.scrollHeight;
}

function appendBotMessage(botMsg) {
  const stream = document.getElementById('chat-messages-stream');
  const div = document.createElement('div');
  div.className = 'msg-bubble msg-bot';
  
  let formattedText = botMsg.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  div.innerHTML = formattedText;

  // 1. Render Voice Snippet Note
  if (botMsg.voice_snippets && botMsg.voice_snippets.length > 0) {
    const voice = botMsg.voice_snippets[0];
    const voiceHtml = `
      <div class="voice-note-card">
        <button class="voice-play-btn" onclick="toggleVoiceSnippet(this)">
          <i class="fas fa-play"></i>
        </button>
        <div style="flex: 1;">
          <div style="font-size: 0.72rem; font-weight: 700; color: #fff;">${voice.title}</div>
          <div class="voice-waveform">
            <span class="waveform-bar" style="height: 8px;"></span>
            <span class="waveform-bar" style="height: 16px;"></span>
            <span class="waveform-bar" style="height: 12px;"></span>
            <span class="waveform-bar" style="height: 20px;"></span>
            <span class="waveform-bar" style="height: 14px;"></span>
            <span class="waveform-bar" style="height: 18px;"></span>
            <span class="waveform-bar" style="height: 10px;"></span>
            <span class="waveform-bar" style="height: 15px;"></span>
          </div>
        </div>
        <span style="font-size: 0.68rem; color: #94a3b8;">${voice.duration}</span>
      </div>
    `;
    div.innerHTML += voiceHtml;
  }

  // 2. Render Gamified Mystery Discount Reveal Card
  if (botMsg.gamified_discount) {
    const g = botMsg.gamified_discount;
    const scratchId = 'scratch_' + Date.now();
    const gamifiedHtml = `
      <div class="gamified-card" id="${scratchId}" onclick="revealMysteryDiscount('${scratchId}', '${g.code}', '${g.discount}')">
        <div style="font-size: 0.75rem; font-weight: 700; color: #f472b6;"><i class="fas fa-gift"></i> ${g.title}</div>
        <div class="scratch-surface" id="${scratchId}_surface">
          <i class="fas fa-hand-pointer"></i> Tap to Scratch & Reveal Discount!
        </div>
        <div style="font-size: 0.68rem; color: #cbd5e1; margin-top: 4px;">Expires in ${g.expires_in}</div>
      </div>
    `;
    div.innerHTML += gamifiedHtml;
  }

  // 3. Render Product Cards with Video/Image & Social Proof Counter
  if (botMsg.product_cards && botMsg.product_cards.length > 0) {
    const card = botMsg.product_cards[0];
    const encodedProduct = encodeURIComponent(JSON.stringify(card));
    const social = card.social_proof || { bought_today: 184, viewing_now: 12, rating: 4.9, badge: '🔥 Best Seller' };

    const cardHtml = `
      <div class="dm-product-card">
        <div class="social-proof-bar">
          <span><i class="fas fa-fire"></i> ${social.bought_today} sold in 24h</span>
          <span><i class="fas fa-eye"></i> ${social.viewing_now} viewing now</span>
        </div>
        <div class="dm-media-container">
          <img src="${card.image_url}" alt="${card.name}">
          <span class="video-badge"><i class="fas fa-star" style="color: #fbbf24;"></i> ${social.rating || '4.9'}</span>
        </div>
        <div class="dm-card-body">
          <h5>${card.name}</h5>
          <div class="dm-card-price">
            <span class="dm-price-current">${money(card.price)}</span>
            ${Number(card.original_price) > Number(card.price) ? `<span class="dm-price-original">${money(card.original_price)}</span>` : ''}
          </div>
          ${card.coupon_code ? `<div class="dm-coupon-pill"><i class="fas fa-tag"></i> Code: ${card.coupon_code}</div>` : ''}
          <button onclick="openCheckoutModal('${encodedProduct}')" class="dm-btn-buy">
            <i class="fas fa-bolt"></i> 1-Click Fast Checkout (${money(card.price)})
          </button>
        </div>
      </div>
    `;
    div.innerHTML += cardHtml;
  }

  // 4. Render Post-Purchase Order Receipt Card
  if (botMsg.order_receipt) {
    const r = botMsg.order_receipt;
    const receiptHtml = `
      <div class="order-receipt-card">
        <div style="font-weight: 700; color: #34d399; font-size: 0.8rem;"><i class="fas fa-check-circle"></i> ${r.status}</div>
        <div style="font-size: 0.72rem; color: #fff; margin-top: 2px;">${r.productName}</div>
        <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: #94a3b8; margin-top: 4px;">
          <span>Tracking: Dispatching in 24h</span>
          <strong style="color: #34d399;">${money(r.price)}</strong>
        </div>
      </div>
    `;
    div.innerHTML += receiptHtml;
  }

  stream.appendChild(div);
  stream.scrollTop = stream.scrollHeight;

  renderQuickReplies(botMsg.quick_replies || []);
}

function revealMysteryDiscount(cardId, code, discount) {
  const surface = document.getElementById(cardId + '_surface');
  if (surface && !surface.classList.contains('scratch-revealed')) {
    surface.classList.add('scratch-revealed');
    surface.innerHTML = `<i class="fas fa-sparkles"></i> UNLOCKED: <strong>${code}</strong> (${discount})`;
    sendUserMessage(`I just unlocked code ${code}! Can you apply the ${discount} to my checkout?`);
  }
}

function toggleVoiceSnippet(btn) {
  const icon = btn.querySelector('i');
  if (icon.classList.contains('fa-play')) {
    icon.classList.remove('fa-play');
    icon.classList.add('fa-pause');
    setTimeout(() => {
      icon.classList.remove('fa-pause');
      icon.classList.add('fa-play');
    }, 3000);
  } else {
    icon.classList.remove('fa-pause');
    icon.classList.add('fa-play');
  }
}

function renderQuickReplies(replies) {
  const container = document.getElementById('quick-replies-container');
  if (!replies || replies.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = replies.map(r => {
    const label = typeof r === 'string' ? r : r.title;
    return `<button class="qr-chip" onclick="sendUserMessage('${label.replace(/'/g, "\\'")}')">${label}</button>`;
  }).join('');
}

function showTypingIndicator() {
  const stream = document.getElementById('chat-messages-stream');
  const id = 'typing_' + Date.now();
  const div = document.createElement('div');
  div.id = id;
  div.className = 'msg-bubble msg-bot';
  div.style.padding = '0.5rem 0.8rem';
  div.innerHTML = '<i class="fas fa-ellipsis-h fa-beat-fade" style="color: #888;"></i>';
  stream.appendChild(div);
  stream.scrollTop = stream.scrollHeight;
  return id;
}

function removeTypingIndicator(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function updateInspector(conv, lead) {
  if (!conv) return;

  const stages = ['HOOK', 'QUALIFY', 'RECOMMEND', 'OBJECTION_HANDLING', 'CLOSING'];
  const currentIdx = stages.indexOf(conv.stage);

  stages.forEach((st, idx) => {
    const el = document.getElementById(`funnel-${st}`);
    if (el) {
      el.className = 'funnel-node';
      if (idx === currentIdx) el.classList.add('active');
      else if (idx < currentIdx) el.classList.add('passed');
    }
  });

  const intent = conv.intent_score || 'HOT';
  const badge = document.getElementById('lead-intent-badge');
  badge.className = `intent-badge intent-${intent}`;
  badge.innerText = `${intent} INTENT`;

  if (lead && lead.cart_value) {
    document.getElementById('lead-cart-value').innerText = money(lead.cart_value);
  }

  document.getElementById('ai-attributes-box').innerText = JSON.stringify(conv.attributes || { fit: "streetwear oversized", sizing: "Size L matched" }, null, 2);
}

async function saveGeminiKey() {
  const key = document.getElementById('gemini-key-input').value.trim();
  const statusEl = document.getElementById('gemini-status-text');

  if (!key) {
    statusEl.innerText = 'Please enter a valid API key.';
    statusEl.style.color = '#f87171';
    return;
  }

  try {
    const res = await fetch('/api/simulator/config/gemini-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key, model: 'gemini-flash-latest' })
    });

    const data = await res.json();
    if (data.success) {
      statusEl.innerText = '✓ Key activated! Running live Gemini 2.0 Flash engine.';
      statusEl.style.color = '#34d399';
    }
  } catch (err) {
    statusEl.innerText = 'Failed to update key: ' + err.message;
    statusEl.style.color = '#f87171';
  }
}

async function saveMetaCredentials() {
  const token = document.getElementById('meta-token-input')?.value.trim();
  const verify = document.getElementById('meta-verify-input')?.value.trim();
  const accId = document.getElementById('meta-account-input')?.value?.trim();
  const waPhoneId = document.getElementById('whatsapp-phone-input')?.value?.trim();
  const statusEl = document.getElementById('meta-status-text');

  try {
    const res = await fetch('/api/simulator/config/meta-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageAccessToken: token,
        verifyToken: verify,
        instagramAccountId: accId,
        whatsappToken: token,
        whatsappPhoneId: waPhoneId
      })
    });
    const data = await res.json();
    if (data.success) {
      statusEl.innerText = '✓ Meta Instagram & WhatsApp credentials saved live! Ready for live DMs & Chats.';
      statusEl.style.color = '#34d399';
    }
  } catch (err) {
    statusEl.innerText = 'Error saving credentials: ' + err.message;
    statusEl.style.color = '#f87171';
  }
}

async function testMetaConnectionLive() {
  const token = document.getElementById('meta-token-input')?.value.trim();
  const phoneId = document.getElementById('whatsapp-phone-input')?.value.trim();
  const statusEl = document.getElementById('meta-status-text');

  if (!token) {
    statusEl.innerText = '❌ Please paste your Meta Access Token first (starts with EAA...)';
    statusEl.style.color = '#f87171';
    return;
  }

  statusEl.innerText = '🔍 Testing connection with Meta Graph API servers...';
  statusEl.style.color = '#60a5fa';

  try {
    const res = await fetch('/api/simulator/test-meta-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, phoneId })
    });
    const data = await res.json();
    if (data.success) {
      statusEl.innerText = data.message;
      statusEl.style.color = '#34d399';
    } else {
      statusEl.innerText = data.message;
      statusEl.style.color = '#f87171';
    }
  } catch (err) {
    statusEl.innerText = 'Connection test failed: ' + err.message;
    statusEl.style.color = '#f87171';
  }
}

async function sendLiveTestMessage() {
  const channel = document.getElementById('test-channel-select').value;
  const recipient = document.getElementById('test-recipient-input').value.trim();
  const text = document.getElementById('test-msg-input').value.trim();
  const statusEl = document.getElementById('live-test-status');

  if (!recipient) {
    statusEl.innerText = '❌ Please enter recipient phone number or IG ID';
    statusEl.style.color = '#f87171';
    return;
  }

  statusEl.innerText = '📤 Dispatching message via Meta Cloud API...';
  statusEl.style.color = '#60a5fa';

  try {
    const res = await fetch('/api/simulator/send-live-test-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, recipient, text })
    });
    const data = await res.json();
    if (data.success) {
      statusEl.innerText = data.message;
      statusEl.style.color = '#34d399';
      loadWebhookLogs();
    } else {
      statusEl.innerText = data.message;
      statusEl.style.color = '#f87171';
    }
  } catch (err) {
    statusEl.innerText = 'Test message failed: ' + err.message;
    statusEl.style.color = '#f87171';
  }
}

async function loadWebhookLogs() {
  const container = document.getElementById('webhook-logs-container');
  if (!container) return;

  try {
    const res = await fetch('/api/simulator/webhook-logs');
    const data = await res.json();
    if (data.success && data.logs && data.logs.length > 0) {
      container.innerHTML = data.logs.map(l => {
        const color = l.status === 'SUCCESS' ? '#34d399' : (l.status === 'WARNING' ? '#fbbf24' : '#f87171');
        return `
          <div style="margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.04); padding-bottom: 2px;">
            <span style="color: #64748b;">[${l.timestamp}]</span>
            <span style="color: ${color}; font-weight: bold;">[${l.type}]</span>
            <span style="color: #e2e8f0;">${l.details}</span>
          </div>
        `;
      }).join('');
    } else {
      container.innerHTML = '<div>[Ready] No external webhook events received yet. Send a test message or WhatsApp DM!</div>';
    }
  } catch (err) {}
}

// Auto poll webhook logs when setup tab is open
setInterval(() => {
  const setupTab = document.getElementById('tab-setup');
  if (setupTab && setupTab.classList.contains('active')) {
    loadWebhookLogs();
  }
}, 4000);



// let currentStore = 'clothing';
// let currentSessionId = 'sim_session_' + Date.now();
// let activeOrderProduct = null;

// const STORE_CONFIG = {
//   clothing: {
//     name: 'AURA Streetwear',
//     avatar: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=120&fit=crop',
//     promo: 'FLASH15 (15% OFF)',
//     defaultCart: '$54.99',
//     ads: [
//       { id: 'hoodie_sale_50', name: '🔥 50% Off CyberPunk Hoodie (480 GSM)' },
//       { id: 'cargo_pants_viral', name: '👖 AeroFlex Techwear Cargo Pants Drop' },
//       { id: 'heavyweight_tee', name: '👕 Minimalist 280 GSM Boxy Tee Bundle' }
//     ]
//   },
//   electronics: {
//     name: 'NEXUS Tech',
//     avatar: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=120&fit=crop',
//     promo: 'TECH10 (10% OFF)',
//     defaultCart: '$79.99',
//     ads: [
//       { id: 'anc_earbuds_deal', name: '🎧 NEXUS Pro -42dB ANC Earbuds Ad' },
//       { id: 'smartwatch_deal', name: '⌚ TitanTrack Titanium 14-Day Watch Ad' },
//       { id: 'magsafe_travel_charger', name: '🔋 3-in-1 Foldable MagSafe Station Ad' }
//     ]
//   }
// };

// document.addEventListener('DOMContentLoaded', () => {
//   setupTabs();
//   selectStore('clothing');
//   checkBotStatus();
// });
// // Check whether the application server is reachable. The /health endpoint
// // exists in server.js and does not require simulator-specific backend routes.
// async function checkBotStatus() {
//   const statusEl =
//     document.getElementById('bot-status-text') ||
//     document.getElementById('bot-status') ||
//     document.getElementById('simulator-status');

//   try {
//     const response = await fetch('/health', {
//       method: 'GET',
//       credentials: 'same-origin',
//       headers: { Accept: 'application/json' },
//       cache: 'no-store'
//     });

//     if (!response.ok) {
//       throw new Error(`Health check returned HTTP ${response.status}`);
//     }

//     const data = await response.json();
//     const online = data.success === true && data.status === 'online';

//     if (statusEl) {
//       statusEl.textContent = online ? 'Online' : 'Unavailable';
//       statusEl.classList.toggle('online', online);
//       statusEl.classList.toggle('offline', !online);
//       statusEl.setAttribute('aria-live', 'polite');
//     }

//     if (!online) {
//       console.warn('[Simulator] Server health check did not report online status.', data);
//     }

//     return online;
//   } catch (error) {
//     if (statusEl) {
//       statusEl.textContent = 'Unavailable';
//       statusEl.classList.remove('online');
//       statusEl.classList.add('offline');
//       statusEl.setAttribute('aria-live', 'polite');
//     }

//     console.warn('[Simulator] Could not check server status:', error.message);
//     return false;
//   }
// }

// function setupTabs() {
//   document.querySelectorAll('.tab-btn').forEach(btn => {
//     btn.addEventListener('click', () => {
//       document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
//       document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

//       btn.classList.add('active');
//       const tabId = btn.dataset.tab;
//       document.getElementById(`tab-${tabId}`).classList.add('active');

//       if (tabId === 'catalog') loadCatalogView();
//       if (tabId === 'crm') loadCRMView();
//     });
//   });
// }

// function selectStore(storeType) {
//   currentStore = storeType;
  
//   document.querySelectorAll('.store-option').forEach(el => {
//     el.classList.toggle('selected', el.dataset.store === storeType);
//   });

//   const cfg = STORE_CONFIG[storeType];
//   document.getElementById('header-brand-name').innerHTML = `${cfg.name} <i class="fas fa-check-circle verified-icon"></i>`;
//   document.getElementById('header-avatar').src = cfg.avatar;
//   document.getElementById('active-promo-badge').innerText = cfg.promo;
//   document.getElementById('lead-cart-value').innerText = cfg.defaultCart;

//   const adContainer = document.getElementById('ad-buttons-container');
//   adContainer.innerHTML = cfg.ads.map(ad => `
//     <button class="btn btn-ig" onclick="simulateAdClick('${ad.id}', '${ad.name.replace(/'/g, "\\'")}')">
//       <i class="fab fa-instagram"></i> ${ad.name}
//     </button>
//   `).join('');

//   simulateAdClick(cfg.ads[0].id, cfg.ads[0].name);
// }

// async function simulateAdClick(adCampaignId, adName) {
//   currentSessionId = `sim_${currentStore}_${Date.now()}`;
//   const stream = document.getElementById('chat-messages-stream');
//   stream.innerHTML = '<div style="text-align: center; font-size: 0.72rem; color: #666; margin: 0.4rem 0;">— Tapped Instagram Sponsored Ad (Click-to-DM) —</div>';

//   try {
//     const res = await fetch('/api/simulator/ad-click', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({
//         sessionId: currentSessionId,
//         storeType: currentStore,
//         adCampaignId,
//         adName,
//         customerHandle: '@shopper_vip'
//       })
//     });

//     const data = await res.json();
//     if (data.success) {
//       appendBotMessage(data.botMessage);
//       updateInspector(data.conversation);
//     }
//   } catch (err) {
//     console.error('Ad click simulation error:', err);
//   }
// }

// async function sendUserMessage(textOverride) {
//   const input = document.getElementById('user-input-box');
//   const text = textOverride || input.value.trim();
//   if (!text) return;

//   appendUserBubble(text);
//   if (!textOverride) input.value = '';

//   document.getElementById('quick-replies-container').innerHTML = '';
//   const typingId = showTypingIndicator();

//   try {
//     const res = await fetch('/api/simulator/chat', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({
//         sessionId: currentSessionId,
//         userText: text,
//         storeType: currentStore
//       })
//     });

//     removeTypingIndicator(typingId);
//     const data = await res.json();

//     if (data.success) {
//       appendBotMessage(data.botMessage);
//       updateInspector(data.conversation, data.lead);
//     }
//   } catch (err) {
//     removeTypingIndicator(typingId);
//     console.error('Chat error:', err);
//   }
// }

// function handleInputKey(e) {
//   if (e.key === 'Enter') {
//     sendUserMessage();
//   }
// }

// // 1-Click Fast Checkout Simulator & Post-Purchase Trigger
// function openCheckoutModal(productJson) {
//   try {
//     activeOrderProduct = typeof productJson === 'string' ? JSON.parse(decodeURIComponent(productJson)) : productJson;
//   } catch (e) {
//     activeOrderProduct = { name: 'CyberPunk Heavyweight Hoodie', price: 54.99 };
//   }

//   const modal = document.getElementById('checkout-modal');
//   document.getElementById('chk-item-name').innerText = activeOrderProduct.name;
//   document.getElementById('chk-item-price').innerText = `$${activeOrderProduct.price}`;
//   document.getElementById('chk-item-total').innerText = `$${activeOrderProduct.price}`;
//   modal.style.display = 'flex';
// }

// function closeCheckoutModal() {
//   document.getElementById('checkout-modal').style.display = 'none';
// }

// async function completeSimulatedPayment() {
//   closeCheckoutModal();
//   const typingId = showTypingIndicator();

//   try {
//     const res = await fetch('/api/simulator/checkout-complete', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({
//         sessionId: currentSessionId,
//         storeType: currentStore,
//         orderDetails: activeOrderProduct
//       })
//     });

//     removeTypingIndicator(typingId);
//     const data = await res.json();

//     if (data.success) {
//       // Append Receipt and Cross-Sell Sequence
//       if (data.receiptMsg) appendBotMessage(data.receiptMsg);
//       if (data.crossSellMsg) {
//         setTimeout(() => {
//           appendBotMessage(data.crossSellMsg);
//         }, 1200);
//       }

//       // Update Inspector & Funnel to CONVERTED
//       updateInspector({ stage: 'CLOSING', intent_score: 'HOT' }, data.lead);
//     }
//   } catch (err) {
//     removeTypingIndicator(typingId);
//     console.error('Checkout error:', err);
//   }
// }

// async function triggerManualFollowUp(stage) {
//   const typingId = showTypingIndicator();
//   try {
//     const res = await fetch('/api/simulator/trigger-followup', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ sessionId: currentSessionId, stage })
//     });
//     removeTypingIndicator(typingId);
//     const data = await res.json();
//     if (data.success && data.latestMessage) {
//       appendBotMessage(data.latestMessage);
//     }
//   } catch (err) {
//     removeTypingIndicator(typingId);
//     console.error('Follow-up error:', err);
//   }
// }

// async function resetCurrentSession() {
//   await fetch(`/api/simulator/reset/${currentSessionId}`, { method: 'POST' });
//   selectStore(currentStore);
// }

// function appendUserBubble(text) {
//   const stream = document.getElementById('chat-messages-stream');
//   const div = document.createElement('div');
//   div.className = 'msg-bubble msg-user';
//   div.innerText = text;
//   stream.appendChild(div);
//   stream.scrollTop = stream.scrollHeight;
// }

// function appendBotMessage(botMsg) {
//   const stream = document.getElementById('chat-messages-stream');
//   const div = document.createElement('div');
//   div.className = 'msg-bubble msg-bot';
  
//   let formattedText = botMsg.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
//   div.innerHTML = formattedText;

//   // 1. Render Voice Snippet Note
//   if (botMsg.voice_snippets && botMsg.voice_snippets.length > 0) {
//     const voice = botMsg.voice_snippets[0];
//     const voiceHtml = `
//       <div class="voice-note-card">
//         <button class="voice-play-btn" onclick="toggleVoiceSnippet(this)">
//           <i class="fas fa-play"></i>
//         </button>
//         <div style="flex: 1;">
//           <div style="font-size: 0.72rem; font-weight: 700; color: #fff;">${voice.title}</div>
//           <div class="voice-waveform">
//             <span class="waveform-bar" style="height: 8px;"></span>
//             <span class="waveform-bar" style="height: 16px;"></span>
//             <span class="waveform-bar" style="height: 12px;"></span>
//             <span class="waveform-bar" style="height: 20px;"></span>
//             <span class="waveform-bar" style="height: 14px;"></span>
//             <span class="waveform-bar" style="height: 18px;"></span>
//             <span class="waveform-bar" style="height: 10px;"></span>
//             <span class="waveform-bar" style="height: 15px;"></span>
//           </div>
//         </div>
//         <span style="font-size: 0.68rem; color: #94a3b8;">${voice.duration}</span>
//       </div>
//     `;
//     div.innerHTML += voiceHtml;
//   }

//   // 2. Render Gamified Mystery Discount Reveal Card
//   if (botMsg.gamified_discount) {
//     const g = botMsg.gamified_discount;
//     const scratchId = 'scratch_' + Date.now();
//     const gamifiedHtml = `
//       <div class="gamified-card" id="${scratchId}" onclick="revealMysteryDiscount('${scratchId}', '${g.code}', '${g.discount}')">
//         <div style="font-size: 0.75rem; font-weight: 700; color: #f472b6;"><i class="fas fa-gift"></i> ${g.title}</div>
//         <div class="scratch-surface" id="${scratchId}_surface">
//           <i class="fas fa-hand-pointer"></i> Tap to Scratch & Reveal Discount!
//         </div>
//         <div style="font-size: 0.68rem; color: #cbd5e1; margin-top: 4px;">Expires in ${g.expires_in}</div>
//       </div>
//     `;
//     div.innerHTML += gamifiedHtml;
//   }

//   // 3. Render Product Cards with Video/Image & Social Proof Counter
//   if (botMsg.product_cards && botMsg.product_cards.length > 0) {
//     const card = botMsg.product_cards[0];
//     const encodedProduct = encodeURIComponent(JSON.stringify(card));
//     const social = card.social_proof || { bought_today: 184, viewing_now: 12, rating: 4.9, badge: '🔥 Best Seller' };

//     const cardHtml = `
//       <div class="dm-product-card">
//         <div class="social-proof-bar">
//           <span><i class="fas fa-fire"></i> ${social.bought_today} sold in 24h</span>
//           <span><i class="fas fa-eye"></i> ${social.viewing_now} viewing now</span>
//         </div>
//         <div class="dm-media-container">
//           <img src="${card.image_url}" alt="${card.name}">
//           <span class="video-badge"><i class="fas fa-star" style="color: #fbbf24;"></i> ${social.rating || '4.9'}</span>
//         </div>
//         <div class="dm-card-body">
//           <h5>${card.name}</h5>
//           <div class="dm-card-price">
//             <span class="dm-price-current">$${card.price}</span>
//             <span class="dm-price-original">$${card.original_price}</span>
//           </div>
//           ${card.coupon_code ? `<div class="dm-coupon-pill"><i class="fas fa-tag"></i> Code: ${card.coupon_code}</div>` : ''}
//           <button onclick="openCheckoutModal('${encodedProduct}')" class="dm-btn-buy">
//             <i class="fas fa-bolt"></i> 1-Click Fast Checkout ($${card.price})
//           </button>
//         </div>
//       </div>
//     `;
//     div.innerHTML += cardHtml;
//   }

//   // 4. Render Post-Purchase Order Receipt Card
//   if (botMsg.order_receipt) {
//     const r = botMsg.order_receipt;
//     const receiptHtml = `
//       <div class="order-receipt-card">
//         <div style="font-weight: 700; color: #34d399; font-size: 0.8rem;"><i class="fas fa-check-circle"></i> ${r.status}</div>
//         <div style="font-size: 0.72rem; color: #fff; margin-top: 2px;">${r.productName}</div>
//         <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: #94a3b8; margin-top: 4px;">
//           <span>Tracking: Dispatching in 24h</span>
//           <strong style="color: #34d399;">$${r.price}</strong>
//         </div>
//       </div>
//     `;
//     div.innerHTML += receiptHtml;
//   }

//   stream.appendChild(div);
//   stream.scrollTop = stream.scrollHeight;

//   renderQuickReplies(botMsg.quick_replies || []);
// }

// function revealMysteryDiscount(cardId, code, discount) {
//   const surface = document.getElementById(cardId + '_surface');
//   if (surface && !surface.classList.contains('scratch-revealed')) {
//     surface.classList.add('scratch-revealed');
//     surface.innerHTML = `<i class="fas fa-sparkles"></i> UNLOCKED: <strong>${code}</strong> (${discount})`;
//     sendUserMessage(`I just unlocked code ${code}! Can you apply the ${discount} to my checkout?`);
//   }
// }

// function toggleVoiceSnippet(btn) {
//   const icon = btn.querySelector('i');
//   if (icon.classList.contains('fa-play')) {
//     icon.classList.remove('fa-play');
//     icon.classList.add('fa-pause');
//     setTimeout(() => {
//       icon.classList.remove('fa-pause');
//       icon.classList.add('fa-play');
//     }, 3000);
//   } else {
//     icon.classList.remove('fa-pause');
//     icon.classList.add('fa-play');
//   }
// }

// function renderQuickReplies(replies) {
//   const container = document.getElementById('quick-replies-container');
//   if (!replies || replies.length === 0) {
//     container.innerHTML = '';
//     return;
//   }

//   container.innerHTML = replies.map(r => {
//     const label = typeof r === 'string' ? r : r.title;
//     return `<button class="qr-chip" onclick="sendUserMessage('${label.replace(/'/g, "\\'")}')">${label}</button>`;
//   }).join('');
// }

// function showTypingIndicator() {
//   const stream = document.getElementById('chat-messages-stream');
//   const id = 'typing_' + Date.now();
//   const div = document.createElement('div');
//   div.id = id;
//   div.className = 'msg-bubble msg-bot';
//   div.style.padding = '0.5rem 0.8rem';
//   div.innerHTML = '<i class="fas fa-ellipsis-h fa-beat-fade" style="color: #888;"></i>';
//   stream.appendChild(div);
//   stream.scrollTop = stream.scrollHeight;
//   return id;
// }

// function removeTypingIndicator(id) {
//   const el = document.getElementById(id);
//   if (el) el.remove();
// }

// function updateInspector(conv, lead) {
//   if (!conv) return;

//   const stages = ['HOOK', 'QUALIFY', 'RECOMMEND', 'OBJECTION_HANDLING', 'CLOSING'];
//   const currentIdx = stages.indexOf(conv.stage);

//   stages.forEach((st, idx) => {
//     const el = document.getElementById(`funnel-${st}`);
//     if (el) {
//       el.className = 'funnel-node';
//       if (idx === currentIdx) el.classList.add('active');
//       else if (idx < currentIdx) el.classList.add('passed');
//     }
//   });

//   const intent = conv.intent_score || 'HOT';
//   const badge = document.getElementById('lead-intent-badge');
//   badge.className = `intent-badge intent-${intent}`;
//   badge.innerText = `${intent} INTENT`;

//   if (lead && lead.cart_value) {
//     document.getElementById('lead-cart-value').innerText = `$${lead.cart_value}`;
//   }

//   document.getElementById('ai-attributes-box').innerText = JSON.stringify(conv.attributes || { fit: "streetwear oversized", sizing: "Size L matched" }, null, 2);
// }

// async function saveGeminiKey() {
//   const key = document.getElementById('gemini-key-input').value.trim();
//   const statusEl = document.getElementById('gemini-status-text');

//   if (!key) {
//     statusEl.innerText = 'Please enter a valid API key.';
//     statusEl.style.color = '#f87171';
//     return;
//   }

//   try {
//     const res = await fetch('/api/simulator/config/gemini-key', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ apiKey: key, model: 'gemini-flash-latest' })
//     });

//     const data = await res.json();
//     if (data.success) {
//       statusEl.innerText = '✓ Key activated! Running live Gemini 2.0 Flash engine.';
//       statusEl.style.color = '#34d399';
//     }
//   } catch (err) {
//     statusEl.innerText = 'Failed to update key: ' + err.message;
//     statusEl.style.color = '#f87171';
//   }
// }

// async function saveMetaCredentials() {
//   const token = document.getElementById('meta-token-input')?.value.trim();
//   const verify = document.getElementById('meta-verify-input')?.value.trim();
//   const accId = document.getElementById('meta-account-input')?.value?.trim();
//   const waPhoneId = document.getElementById('whatsapp-phone-input')?.value?.trim();
//   const statusEl = document.getElementById('meta-status-text');

//   try {
//     const res = await fetch('/api/simulator/config/meta-keys', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({
//         pageAccessToken: token,
//         verifyToken: verify,
//         instagramAccountId: accId,
//         whatsappToken: token,
//         whatsappPhoneId: waPhoneId
//       })
//     });
//     const data = await res.json();
//     if (data.success) {
//       statusEl.innerText = '✓ Meta Instagram & WhatsApp credentials saved live! Ready for live DMs & Chats.';
//       statusEl.style.color = '#34d399';
//     }
//   } catch (err) {
//     statusEl.innerText = 'Error saving credentials: ' + err.message;
//     statusEl.style.color = '#f87171';
//   }
// }

// async function testMetaConnectionLive() {
//   const token = document.getElementById('meta-token-input')?.value.trim();
//   const phoneId = document.getElementById('whatsapp-phone-input')?.value.trim();
//   const statusEl = document.getElementById('meta-status-text');

//   if (!token) {
//     statusEl.innerText = '❌ Please paste your Meta Access Token first (starts with EAA...)';
//     statusEl.style.color = '#f87171';
//     return;
//   }

//   statusEl.innerText = '🔍 Testing connection with Meta Graph API servers...';
//   statusEl.style.color = '#60a5fa';

//   try {
//     const res = await fetch('/api/simulator/test-meta-connection', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ token, phoneId })
//     });
//     const data = await res.json();
//     if (data.success) {
//       statusEl.innerText = data.message;
//       statusEl.style.color = '#34d399';
//     } else {
//       statusEl.innerText = data.message;
//       statusEl.style.color = '#f87171';
//     }
//   } catch (err) {
//     statusEl.innerText = 'Connection test failed: ' + err.message;
//     statusEl.style.color = '#f87171';
//   }
// }

// async function sendLiveTestMessage() {
//   const channel = document.getElementById('test-channel-select').value;
//   const recipient = document.getElementById('test-recipient-input').value.trim();
//   const text = document.getElementById('test-msg-input').value.trim();
//   const statusEl = document.getElementById('live-test-status');

//   if (!recipient) {
//     statusEl.innerText = '❌ Please enter recipient phone number or IG ID';
//     statusEl.style.color = '#f87171';
//     return;
//   }

//   statusEl.innerText = '📤 Dispatching message via Meta Cloud API...';
//   statusEl.style.color = '#60a5fa';

//   try {
//     const res = await fetch('/api/simulator/send-live-test-message', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ channel, recipient, text })
//     });
//     const data = await res.json();
//     if (data.success) {
//       statusEl.innerText = data.message;
//       statusEl.style.color = '#34d399';
//       loadWebhookLogs();
//     } else {
//       statusEl.innerText = data.message;
//       statusEl.style.color = '#f87171';
//     }
//   } catch (err) {
//     statusEl.innerText = 'Test message failed: ' + err.message;
//     statusEl.style.color = '#f87171';
//   }
// }

// async function loadWebhookLogs() {
//   const container = document.getElementById('webhook-logs-container');
//   if (!container) return;

//   try {
//     const res = await fetch('/api/simulator/webhook-logs');
//     const data = await res.json();
//     if (data.success && data.logs && data.logs.length > 0) {
//       container.innerHTML = data.logs.map(l => {
//         const color = l.status === 'SUCCESS' ? '#34d399' : (l.status === 'WARNING' ? '#fbbf24' : '#f87171');
//         return `
//           <div style="margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.04); padding-bottom: 2px;">
//             <span style="color: #64748b;">[${l.timestamp}]</span>
//             <span style="color: ${color}; font-weight: bold;">[${l.type}]</span>
//             <span style="color: #e2e8f0;">${l.details}</span>
//           </div>
//         `;
//       }).join('');
//     } else {
//       container.innerHTML = '<div>[Ready] No external webhook events received yet. Send a test message or WhatsApp DM!</div>';
//     }
//   } catch (err) {}
// }

// // Auto poll webhook logs when setup tab is open
// setInterval(() => {
//   const setupTab = document.getElementById('tab-setup');
//   if (setupTab && setupTab.classList.contains('active')) {
//     loadWebhookLogs();
//   }
// }, 4000);





// let currentStore = 'clothing';
// let currentSessionId = 'sim_session_' + Date.now();
// let activeOrderProduct = null;

// const STORE_CONFIG = {
//   clothing: {
//     name: 'AURA Streetwear',
//     avatar: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=120&fit=crop',
//     promo: 'FLASH15 (15% OFF)',
//     defaultCart: '$54.99',
//     ads: [
//       { id: 'hoodie_sale_50', name: '🔥 50% Off CyberPunk Hoodie (480 GSM)' },
//       { id: 'cargo_pants_viral', name: '👖 AeroFlex Techwear Cargo Pants Drop' },
//       { id: 'heavyweight_tee', name: '👕 Minimalist 280 GSM Boxy Tee Bundle' }
//     ]
//   },
//   electronics: {
//     name: 'NEXUS Tech',
//     avatar: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=120&fit=crop',
//     promo: 'TECH10 (10% OFF)',
//     defaultCart: '$79.99',
//     ads: [
//       { id: 'anc_earbuds_deal', name: '🎧 NEXUS Pro -42dB ANC Earbuds Ad' },
//       { id: 'smartwatch_deal', name: '⌚ TitanTrack Titanium 14-Day Watch Ad' },
//       { id: 'magsafe_travel_charger', name: '🔋 3-in-1 Foldable MagSafe Station Ad' }
//     ]
//   }
// };

// document.addEventListener('DOMContentLoaded', () => {
//   setupTabs();
//   selectStore('clothing');
//   checkBotStatus();
// });

// function setupTabs() {
//   document.querySelectorAll('.tab-btn').forEach(btn => {
//     btn.addEventListener('click', () => {
//       document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
//       document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

//       btn.classList.add('active');
//       const tabId = btn.dataset.tab;
//       document.getElementById(`tab-${tabId}`).classList.add('active');

//       if (tabId === 'catalog') loadCatalogView();
//       if (tabId === 'crm') loadCRMView();
//     });
//   });
// }

// function selectStore(storeType) {
//   currentStore = storeType;
  
//   document.querySelectorAll('.store-option').forEach(el => {
//     el.classList.toggle('selected', el.dataset.store === storeType);
//   });

//   const cfg = STORE_CONFIG[storeType];
//   document.getElementById('header-brand-name').innerHTML = `${cfg.name} <i class="fas fa-check-circle verified-icon"></i>`;
//   document.getElementById('header-avatar').src = cfg.avatar;
//   document.getElementById('active-promo-badge').innerText = cfg.promo;
//   document.getElementById('lead-cart-value').innerText = cfg.defaultCart;

//   const adContainer = document.getElementById('ad-buttons-container');
//   adContainer.innerHTML = cfg.ads.map(ad => `
//     <button class="btn btn-ig" onclick="simulateAdClick('${ad.id}', '${ad.name.replace(/'/g, "\\'")}')">
//       <i class="fab fa-instagram"></i> ${ad.name}
//     </button>
//   `).join('');

//   simulateAdClick(cfg.ads[0].id, cfg.ads[0].name);
// }

// async function simulateAdClick(adCampaignId, adName) {
//   currentSessionId = `sim_${currentStore}_${Date.now()}`;
//   const stream = document.getElementById('chat-messages-stream');
//   stream.innerHTML = '<div style="text-align: center; font-size: 0.72rem; color: #666; margin: 0.4rem 0;">— Tapped Instagram Sponsored Ad (Click-to-DM) —</div>';

//   try {
//     const res = await fetch('/api/simulator/ad-click', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({
//         sessionId: currentSessionId,
//         storeType: currentStore,
//         adCampaignId,
//         adName,
//         customerHandle: '@shopper_vip'
//       })
//     });

//     const data = await res.json();
//     if (data.success) {
//       appendBotMessage(data.botMessage);
//       updateInspector(data.conversation);
//     }
//   } catch (err) {
//     console.error('Ad click simulation error:', err);
//   }
// }

// async function sendUserMessage(textOverride) {
//   const input = document.getElementById('user-input-box');
//   const text = textOverride || input.value.trim();
//   if (!text) return;

//   appendUserBubble(text);
//   if (!textOverride) input.value = '';

//   document.getElementById('quick-replies-container').innerHTML = '';
//   const typingId = showTypingIndicator();

//   try {
//     const res = await fetch('/api/simulator/chat', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({
//         sessionId: currentSessionId,
//         userText: text,
//         storeType: currentStore
//       })
//     });

//     removeTypingIndicator(typingId);
//     const data = await res.json();

//     if (data.success) {
//       appendBotMessage(data.botMessage);
//       updateInspector(data.conversation, data.lead);
//     }
//   } catch (err) {
//     removeTypingIndicator(typingId);
//     console.error('Chat error:', err);
//   }
// }

// function handleInputKey(e) {
//   if (e.key === 'Enter') {
//     sendUserMessage();
//   }
// }

// // 1-Click Fast Checkout Simulator & Post-Purchase Trigger
// function openCheckoutModal(productJson) {
//   try {
//     activeOrderProduct = typeof productJson === 'string' ? JSON.parse(decodeURIComponent(productJson)) : productJson;
//   } catch (e) {
//     activeOrderProduct = { name: 'CyberPunk Heavyweight Hoodie', price: 54.99 };
//   }

//   const modal = document.getElementById('checkout-modal');
//   document.getElementById('chk-item-name').innerText = activeOrderProduct.name;
//   document.getElementById('chk-item-price').innerText = `$${activeOrderProduct.price}`;
//   document.getElementById('chk-item-total').innerText = `$${activeOrderProduct.price}`;
//   modal.style.display = 'flex';
// }

// function closeCheckoutModal() {
//   document.getElementById('checkout-modal').style.display = 'none';
// }

// async function completeSimulatedPayment() {
//   closeCheckoutModal();
//   const typingId = showTypingIndicator();

//   try {
//     const res = await fetch('/api/simulator/checkout-complete', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({
//         sessionId: currentSessionId,
//         storeType: currentStore,
//         orderDetails: activeOrderProduct
//       })
//     });

//     removeTypingIndicator(typingId);
//     const data = await res.json();

//     if (data.success) {
//       // Append Receipt and Cross-Sell Sequence
//       if (data.receiptMsg) appendBotMessage(data.receiptMsg);
//       if (data.crossSellMsg) {
//         setTimeout(() => {
//           appendBotMessage(data.crossSellMsg);
//         }, 1200);
//       }

//       // Update Inspector & Funnel to CONVERTED
//       updateInspector({ stage: 'CLOSING', intent_score: 'HOT' }, data.lead);
//     }
//   } catch (err) {
//     removeTypingIndicator(typingId);
//     console.error('Checkout error:', err);
//   }
// }

// async function triggerManualFollowUp(stage) {
//   const typingId = showTypingIndicator();
//   try {
//     const res = await fetch('/api/simulator/trigger-followup', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ sessionId: currentSessionId, stage })
//     });
//     removeTypingIndicator(typingId);
//     const data = await res.json();
//     if (data.success && data.latestMessage) {
//       appendBotMessage(data.latestMessage);
//     }
//   } catch (err) {
//     removeTypingIndicator(typingId);
//     console.error('Follow-up error:', err);
//   }
// }

// async function resetCurrentSession() {
//   await fetch(`/api/simulator/reset/${currentSessionId}`, { method: 'POST' });
//   selectStore(currentStore);
// }

// function appendUserBubble(text) {
//   const stream = document.getElementById('chat-messages-stream');
//   const div = document.createElement('div');
//   div.className = 'msg-bubble msg-user';
//   div.innerText = text;
//   stream.appendChild(div);
//   stream.scrollTop = stream.scrollHeight;
// }

// function appendBotMessage(botMsg) {
//   const stream = document.getElementById('chat-messages-stream');
//   const div = document.createElement('div');
//   div.className = 'msg-bubble msg-bot';
  
//   let formattedText = botMsg.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
//   div.innerHTML = formattedText;

//   // 1. Render Voice Snippet Note
//   if (botMsg.voice_snippets && botMsg.voice_snippets.length > 0) {
//     const voice = botMsg.voice_snippets[0];
//     const voiceHtml = `
//       <div class="voice-note-card">
//         <button class="voice-play-btn" onclick="toggleVoiceSnippet(this)">
//           <i class="fas fa-play"></i>
//         </button>
//         <div style="flex: 1;">
//           <div style="font-size: 0.72rem; font-weight: 700; color: #fff;">${voice.title}</div>
//           <div class="voice-waveform">
//             <span class="waveform-bar" style="height: 8px;"></span>
//             <span class="waveform-bar" style="height: 16px;"></span>
//             <span class="waveform-bar" style="height: 12px;"></span>
//             <span class="waveform-bar" style="height: 20px;"></span>
//             <span class="waveform-bar" style="height: 14px;"></span>
//             <span class="waveform-bar" style="height: 18px;"></span>
//             <span class="waveform-bar" style="height: 10px;"></span>
//             <span class="waveform-bar" style="height: 15px;"></span>
//           </div>
//         </div>
//         <span style="font-size: 0.68rem; color: #94a3b8;">${voice.duration}</span>
//       </div>
//     `;
//     div.innerHTML += voiceHtml;
//   }

//   // 2. Render Gamified Mystery Discount Reveal Card
//   if (botMsg.gamified_discount) {
//     const g = botMsg.gamified_discount;
//     const scratchId = 'scratch_' + Date.now();
//     const gamifiedHtml = `
//       <div class="gamified-card" id="${scratchId}" onclick="revealMysteryDiscount('${scratchId}', '${g.code}', '${g.discount}')">
//         <div style="font-size: 0.75rem; font-weight: 700; color: #f472b6;"><i class="fas fa-gift"></i> ${g.title}</div>
//         <div class="scratch-surface" id="${scratchId}_surface">
//           <i class="fas fa-hand-pointer"></i> Tap to Scratch & Reveal Discount!
//         </div>
//         <div style="font-size: 0.68rem; color: #cbd5e1; margin-top: 4px;">Expires in ${g.expires_in}</div>
//       </div>
//     `;
//     div.innerHTML += gamifiedHtml;
//   }

//   // 3. Render Product Cards with Video/Image & Social Proof Counter
//   if (botMsg.product_cards && botMsg.product_cards.length > 0) {
//     const card = botMsg.product_cards[0];
//     const encodedProduct = encodeURIComponent(JSON.stringify(card));
//     const social = card.social_proof || { bought_today: 184, viewing_now: 12, rating: 4.9, badge: '🔥 Best Seller' };

//     const cardHtml = `
//       <div class="dm-product-card">
//         <div class="social-proof-bar">
//           <span><i class="fas fa-fire"></i> ${social.bought_today} sold in 24h</span>
//           <span><i class="fas fa-eye"></i> ${social.viewing_now} viewing now</span>
//         </div>
//         <div class="dm-media-container">
//           <img src="${card.image_url}" alt="${card.name}">
//           <span class="video-badge"><i class="fas fa-star" style="color: #fbbf24;"></i> ${social.rating || '4.9'}</span>
//         </div>
//         <div class="dm-card-body">
//           <h5>${card.name}</h5>
//           <div class="dm-card-price">
//             <span class="dm-price-current">$${card.price}</span>
//             <span class="dm-price-original">$${card.original_price}</span>
//           </div>
//           ${card.coupon_code ? `<div class="dm-coupon-pill"><i class="fas fa-tag"></i> Code: ${card.coupon_code}</div>` : ''}
//           <button onclick="openCheckoutModal('${encodedProduct}')" class="dm-btn-buy">
//             <i class="fas fa-bolt"></i> 1-Click Fast Checkout ($${card.price})
//           </button>
//         </div>
//       </div>
//     `;
//     div.innerHTML += cardHtml;
//   }

//   // 4. Render Post-Purchase Order Receipt Card
//   if (botMsg.order_receipt) {
//     const r = botMsg.order_receipt;
//     const receiptHtml = `
//       <div class="order-receipt-card">
//         <div style="font-weight: 700; color: #34d399; font-size: 0.8rem;"><i class="fas fa-check-circle"></i> ${r.status}</div>
//         <div style="font-size: 0.72rem; color: #fff; margin-top: 2px;">${r.productName}</div>
//         <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: #94a3b8; margin-top: 4px;">
//           <span>Tracking: Dispatching in 24h</span>
//           <strong style="color: #34d399;">$${r.price}</strong>
//         </div>
//       </div>
//     `;
//     div.innerHTML += receiptHtml;
//   }

//   stream.appendChild(div);
//   stream.scrollTop = stream.scrollHeight;

//   renderQuickReplies(botMsg.quick_replies || []);
// }

// function revealMysteryDiscount(cardId, code, discount) {
//   const surface = document.getElementById(cardId + '_surface');
//   if (surface && !surface.classList.contains('scratch-revealed')) {
//     surface.classList.add('scratch-revealed');
//     surface.innerHTML = `<i class="fas fa-sparkles"></i> UNLOCKED: <strong>${code}</strong> (${discount})`;
//     sendUserMessage(`I just unlocked code ${code}! Can you apply the ${discount} to my checkout?`);
//   }
// }

// function toggleVoiceSnippet(btn) {
//   const icon = btn.querySelector('i');
//   if (icon.classList.contains('fa-play')) {
//     icon.classList.remove('fa-play');
//     icon.classList.add('fa-pause');
//     setTimeout(() => {
//       icon.classList.remove('fa-pause');
//       icon.classList.add('fa-play');
//     }, 3000);
//   } else {
//     icon.classList.remove('fa-pause');
//     icon.classList.add('fa-play');
//   }
// }

// function renderQuickReplies(replies) {
//   const container = document.getElementById('quick-replies-container');
//   if (!replies || replies.length === 0) {
//     container.innerHTML = '';
//     return;
//   }

//   container.innerHTML = replies.map(r => {
//     const label = typeof r === 'string' ? r : r.title;
//     return `<button class="qr-chip" onclick="sendUserMessage('${label.replace(/'/g, "\\'")}')">${label}</button>`;
//   }).join('');
// }

// function showTypingIndicator() {
//   const stream = document.getElementById('chat-messages-stream');
//   const id = 'typing_' + Date.now();
//   const div = document.createElement('div');
//   div.id = id;
//   div.className = 'msg-bubble msg-bot';
//   div.style.padding = '0.5rem 0.8rem';
//   div.innerHTML = '<i class="fas fa-ellipsis-h fa-beat-fade" style="color: #888;"></i>';
//   stream.appendChild(div);
//   stream.scrollTop = stream.scrollHeight;
//   return id;
// }

// function removeTypingIndicator(id) {
//   const el = document.getElementById(id);
//   if (el) el.remove();
// }

// function updateInspector(conv, lead) {
//   if (!conv) return;

//   const stages = ['HOOK', 'QUALIFY', 'RECOMMEND', 'OBJECTION_HANDLING', 'CLOSING'];
//   const currentIdx = stages.indexOf(conv.stage);

//   stages.forEach((st, idx) => {
//     const el = document.getElementById(`funnel-${st}`);
//     if (el) {
//       el.className = 'funnel-node';
//       if (idx === currentIdx) el.classList.add('active');
//       else if (idx < currentIdx) el.classList.add('passed');
//     }
//   });

//   const intent = conv.intent_score || 'HOT';
//   const badge = document.getElementById('lead-intent-badge');
//   badge.className = `intent-badge intent-${intent}`;
//   badge.innerText = `${intent} INTENT`;

//   if (lead && lead.cart_value) {
//     document.getElementById('lead-cart-value').innerText = `$${lead.cart_value}`;
//   }

//   document.getElementById('ai-attributes-box').innerText = JSON.stringify(conv.attributes || { fit: "streetwear oversized", sizing: "Size L matched" }, null, 2);
// }

// async function saveGeminiKey() {
//   const key = document.getElementById('gemini-key-input').value.trim();
//   const statusEl = document.getElementById('gemini-status-text');

//   if (!key) {
//     statusEl.innerText = 'Please enter a valid API key.';
//     statusEl.style.color = '#f87171';
//     return;
//   }

//   try {
//     const res = await fetch('/api/simulator/config/gemini-key', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ apiKey: key, model: 'gemini-flash-latest' })
//     });

//     const data = await res.json();
//     if (data.success) {
//       statusEl.innerText = '✓ Key activated! Running live Gemini 2.0 Flash engine.';
//       statusEl.style.color = '#34d399';
//     }
//   } catch (err) {
//     statusEl.innerText = 'Failed to update key: ' + err.message;
//     statusEl.style.color = '#f87171';
//   }
// }

// async function saveMetaCredentials() {
//   const token = document.getElementById('meta-token-input')?.value.trim();
//   const verify = document.getElementById('meta-verify-input')?.value.trim();
//   const accId = document.getElementById('meta-account-input')?.value?.trim();
//   const waPhoneId = document.getElementById('whatsapp-phone-input')?.value?.trim();
//   const statusEl = document.getElementById('meta-status-text');

//   try {
//     const res = await fetch('/api/simulator/config/meta-keys', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({
//         pageAccessToken: token,
//         verifyToken: verify,
//         instagramAccountId: accId,
//         whatsappToken: token,
//         whatsappPhoneId: waPhoneId
//       })
//     });
//     const data = await res.json();
//     if (data.success) {
//       statusEl.innerText = '✓ Meta Instagram & WhatsApp credentials saved live! Ready for live DMs & Chats.';
//       statusEl.style.color = '#34d399';
//     }
//   } catch (err) {
//     statusEl.innerText = 'Error saving credentials: ' + err.message;
//     statusEl.style.color = '#f87171';
//   }
// }

// async function testMetaConnectionLive() {
//   const token = document.getElementById('meta-token-input')?.value.trim();
//   const phoneId = document.getElementById('whatsapp-phone-input')?.value.trim();
//   const statusEl = document.getElementById('meta-status-text');

//   if (!token) {
//     statusEl.innerText = '❌ Please paste your Meta Access Token first (starts with EAA...)';
//     statusEl.style.color = '#f87171';
//     return;
//   }

//   statusEl.innerText = '🔍 Testing connection with Meta Graph API servers...';
//   statusEl.style.color = '#60a5fa';

//   try {
//     const res = await fetch('/api/simulator/test-meta-connection', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ token, phoneId })
//     });
//     const data = await res.json();
//     if (data.success) {
//       statusEl.innerText = data.message;
//       statusEl.style.color = '#34d399';
//     } else {
//       statusEl.innerText = data.message;
//       statusEl.style.color = '#f87171';
//     }
//   } catch (err) {
//     statusEl.innerText = 'Connection test failed: ' + err.message;
//     statusEl.style.color = '#f87171';
//   }
// }

// async function sendLiveTestMessage() {
//   const channel = document.getElementById('test-channel-select').value;
//   const recipient = document.getElementById('test-recipient-input').value.trim();
//   const text = document.getElementById('test-msg-input').value.trim();
//   const statusEl = document.getElementById('live-test-status');

//   if (!recipient) {
//     statusEl.innerText = '❌ Please enter recipient phone number or IG ID';
//     statusEl.style.color = '#f87171';
//     return;
//   }

//   statusEl.innerText = '📤 Dispatching message via Meta Cloud API...';
//   statusEl.style.color = '#60a5fa';

//   try {
//     const res = await fetch('/api/simulator/send-live-test-message', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ channel, recipient, text })
//     });
//     const data = await res.json();
//     if (data.success) {
//       statusEl.innerText = data.message;
//       statusEl.style.color = '#34d399';
//       loadWebhookLogs();
//     } else {
//       statusEl.innerText = data.message;
//       statusEl.style.color = '#f87171';
//     }
//   } catch (err) {
//     statusEl.innerText = 'Test message failed: ' + err.message;
//     statusEl.style.color = '#f87171';
//   }
// }

// async function loadWebhookLogs() {
//   const container = document.getElementById('webhook-logs-container');
//   if (!container) return;

//   try {
//     const res = await fetch('/api/simulator/webhook-logs');
//     const data = await res.json();
//     if (data.success && data.logs && data.logs.length > 0) {
//       container.innerHTML = data.logs.map(l => {
//         const color = l.status === 'SUCCESS' ? '#34d399' : (l.status === 'WARNING' ? '#fbbf24' : '#f87171');
//         return `
//           <div style="margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.04); padding-bottom: 2px;">
//             <span style="color: #64748b;">[${l.timestamp}]</span>
//             <span style="color: ${color}; font-weight: bold;">[${l.type}]</span>
//             <span style="color: #e2e8f0;">${l.details}</span>
//           </div>
//         `;
//       }).join('');
//     } else {
//       container.innerHTML = '<div>[Ready] No external webhook events received yet. Send a test message or WhatsApp DM!</div>';
//     }
//   } catch (err) {}
// }

// // Auto poll webhook logs when setup tab is open
// setInterval(() => {
//   const setupTab = document.getElementById('tab-setup');
//   if (setupTab && setupTab.classList.contains('active')) {
//     loadWebhookLogs();
//   }
// }, 4000);
