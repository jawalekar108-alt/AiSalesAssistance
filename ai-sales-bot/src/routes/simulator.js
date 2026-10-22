//18/10

const express = require('express');
const router = express.Router();
const conversationFlow = require('../engine/conversationFlow');
const followUpWorker = require('../engine/followUpWorker');
const geminiClient = require('../engine/gemini');
const db = require('../config/database');
const { requireAdmin } = require('../services/auth');

/*
 * MULTI-TENANT SIMULATOR
 *
 * - Business owners (role "owner") are ALWAYS locked to their own store, whatever the browser sends.
 *   Their simulator sessions are prefixed (sim_<storeId>_...) so two businesses can never share a chat.
 * - Admin (role "admin") can still switch between the clothing / electronics demo stores.
 * - Platform settings and diagnostics (API keys, test sends, webhook logs) are ADMIN ONLY.
 */

function getTenant(req) {
  const u = req.user;
  if (!u) return null;

  if (u.role === 'admin') {
    const wanted =
      req.body?.storeType ||
      req.body?.store_type ||
      req.query?.storeType ||
      req.query?.store_type ||
      u.home_store_id;

    const store = db.getStore(wanted) || db.getStore(u.home_store_id);
    return store ? { store, isAdmin: true } : null;
  }

  const store = db.getStore(u.store_id);
  return store ? { store, isAdmin: false } : null;
}

function needTenant(req, res) {
  const tenant = getTenant(req);

  if (!tenant) {
    res.status(401).json({ success: false, message: 'Login required' });
    return null;
  }

  return tenant;
}

function scopeSession(tenant, raw) {
  const id = String(raw || '').trim();
  if (!id || tenant.isAdmin) return id;

  return `sim_${tenant.store.id}_${id.replace(/[^\w.-]/g, '').slice(0, 80)}`;
}

function analyticsFor(tenant) {
  if (tenant.isAdmin) return db.getAnalytics();

  const id = tenant.store.id;
  const leads = db.getLeads(id);
  const converted = leads.filter(l => l.status === 'PURCHASED');
  const revenue = converted.reduce((sum, l) => sum + (Number(l.cart_value) || 0), 0);
  const currency = tenant.store.currency || process.env.CURRENCY_SYMBOL || '₹';

  return {
    totalConversations: db.getRecentConversations(100000, id).length,
    totalMessages: db.data.messages.filter(m => String(m.store_id || '') === String(id)).length,
    totalLeads: leads.length,
    convertedLeads: converted.length,
    checkoutClickedLeads: leads.filter(l => l.status === 'CHECKOUT_CLICKED').length,
    conversionRate: leads.length ? ((converted.length / leads.length) * 100).toFixed(1) + '%' : '0%',
    hotLeads: leads.filter(l => l.intent_score === 'HOT').length,
    totalRevenue: currency + revenue.toFixed(2),
    totalProducts: db.getProducts(id).length,
    instagramProducts: db.getProducts(id).filter(p => p.source === 'instagram').length
  };
}

/* ============================================================
 * WHO AM I
 * The dashboard asks this once so it can hide the demo stores from business owners
 * and show only the owner's own store. (The server already locks owners to their store.)
 * ============================================================ */

router.get('/me', (req, res) => {
  const tenant = needTenant(req, res);
  if (!tenant) return;

  const store = tenant.store;

  res.json({
    success: true,
    isAdmin: tenant.isAdmin,
    store: {
      id: store.id,
      type: store.type || store.id,
      name: store.name,
      business_name: store.business_name || store.name,
      currency: store.currency || process.env.CURRENCY_SYMBOL || '₹',
      active_promo_code: store.active_promo_code || '',
      promo_discount_percent: store.promo_discount_percent || 0
    }
  });
});

/* ============================================================
 * CHAT
 * ============================================================ */

router.post('/chat', async (req, res) => {
  try {
    const tenant = needTenant(req, res);
    if (!tenant) return;

    const { sessionId, userText } = req.body;

    if (!sessionId || !userText) {
      return res.status(400).json({ success: false, message: 'sessionId and userText are required' });
    }

    const result = await conversationFlow.handleMessage({
      sessionId: scopeSession(tenant, sessionId),
      userText,
      storeType: tenant.store.type || tenant.store.id,
      storeId: tenant.store.id,
      platform: 'simulator'
    });

    res.json({
      success: true,
      botMessage: result.message,
      conversation: result.conversation,
      lead: result.lead
    });
  } catch (err) {
    console.error('[Simulator Error]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================================
 * AD CLICK
 * ============================================================ */

router.post('/ad-click', async (req, res) => {
  try {
    const tenant = needTenant(req, res);
    if (!tenant) return;

    const { sessionId, adCampaignId, adName, customerHandle } = req.body;

    const result = await conversationFlow.handleAdReferral({
      sessionId: scopeSession(tenant, sessionId || `sim_${Date.now()}`),
      storeType: tenant.store.type || tenant.store.id,
      storeId: tenant.store.id,
      adCampaignId: adCampaignId || 'ig_ad_001',
      adName: adName || 'Instagram Ad Campaign',
      customerHandle: customerHandle || '@vip_shopper',
      platform: 'simulator'
    });

    res.json({
      success: true,
      botMessage: result.message,
      conversation: result.conversation
    });
  } catch (err) {
    console.error('[Simulator Ad Click Error]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================================
 * CHECKOUT COMPLETE
 * ============================================================ */

router.post('/checkout-complete', async (req, res) => {
  try {
    const tenant = needTenant(req, res);
    if (!tenant) return;

    const { sessionId, orderDetails } = req.body;
    const scoped = scopeSession(tenant, sessionId || `sim_${Date.now()}`);
    const storeType = tenant.store.type || tenant.store.id;

    let lead = null;
    let receiptMsg = '';
    let crossSellMsg = '';

    if (typeof conversationFlow.handlePostPurchase === 'function') {
      const result = await conversationFlow.handlePostPurchase({
        sessionId: scoped,
        storeType,
        storeId: tenant.store.id,
        orderDetails: orderDetails || {}
      });

      lead = result.lead;
      receiptMsg = result.receiptMsg;
      crossSellMsg = result.crossSellMsg;
    } else {
      // handlePostPurchase does not exist in the current conversationFlow.js
      db.getOrCreateConversation(scoped, storeType, 'simulator', {}, tenant.store.id);
      lead = db.completeCheckout(scoped, orderDetails || {});

      const item = orderDetails?.product_name ? ` for ${orderDetails.product_name}` : '';
      receiptMsg = `✅ Order confirmed${item}! Thank you for shopping with ${tenant.store.business_name || 'us'}.`;
    }

    res.json({
      success: true,
      lead,
      receiptMsg,
      crossSellMsg,
      analytics: analyticsFor(tenant)
    });
  } catch (err) {
    console.error('[Checkout Complete Error]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================================
 * FOLLOW-UP TEST / HISTORY / RESET (scoped to the tenant)
 * ============================================================ */

router.post('/trigger-followup', async (req, res) => {
  try {
    const tenant = needTenant(req, res);
    if (!tenant) return;

    const { sessionId, stage } = req.body;
    const scoped = scopeSession(tenant, sessionId);

    const conversation = db.getConversation(scoped);

    if (!conversation || (!tenant.isAdmin && String(conversation.store_id) !== String(tenant.store.id))) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    await followUpWorker.executeFollowUp({
      id: `manual_fu_${Date.now()}`,
      conversation_id: scoped,
      stage: stage || 1
    });

    const messages = db.getMessages(scoped);

    res.json({
      success: true,
      latestMessage: messages[messages.length - 1],
      messages
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/history/:sessionId', (req, res) => {
  const tenant = needTenant(req, res);
  if (!tenant) return;

  const scoped = scopeSession(tenant, req.params.sessionId);

  res.json({
    success: true,
    messages: db.getMessages(scoped),
    conversation: db.getConversation(scoped),
    lead: db.getLeadBySession(scoped)
  });
});

router.post('/reset/:sessionId', (req, res) => {
  const tenant = needTenant(req, res);
  if (!tenant) return;

  const scoped = scopeSession(tenant, req.params.sessionId);

  db.data.messages = db.data.messages.filter(m => m.conversation_id !== scoped);
  db.data.conversations = db.data.conversations.filter(c => c.session_id !== scoped);
  db.data.leads = db.data.leads.filter(l => l.conversation_id !== scoped);
  db.data.follow_ups = db.data.follow_ups.filter(f => f.conversation_id !== scoped);
  db.saveData();

  res.json({ success: true, message: 'Session reset successfully' });
});

/* ============================================================
 * STATUS (admin: platform totals, owner: own store only)
 * ============================================================ */

router.get('/status', (req, res) => {
  const tenant = needTenant(req, res);
  if (!tenant) return;

  if (tenant.isAdmin) {
    return res.json({
      success: true,
      hasGeminiKey: geminiClient.hasApiKey(),
      model: geminiClient.model,
      hasMetaKey: !!(process.env.META_PAGE_ACCESS_TOKEN && process.env.META_PAGE_ACCESS_TOKEN.length > 10),
      hasWhatsAppKey: !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
      autoFollowUpEnabled: followUpWorker.isRunning,
      storesCount: db.getStores().length,
      productsCount: db.getProducts().length,
      leadsCount: db.getLeads().length
    });
  }

  res.json({
    success: true,
    hasGeminiKey: geminiClient.hasApiKey(),
    model: geminiClient.model,
    hasMetaKey: Boolean(tenant.store.instagram_user_id && tenant.store.instagram_access_token),
    hasWhatsAppKey: false,
    autoFollowUpEnabled: followUpWorker.isRunning,
    storesCount: 1,
    productsCount: db.getProducts(tenant.store.id).length,
    leadsCount: db.getLeads(tenant.store.id).length
  });
});

/* ============================================================
 * ADMIN ONLY: platform keys, diagnostics, logs
 * (before this change ANY logged-in user could overwrite the platform's
 *  Meta tokens, send messages with them, and read all webhook logs)
 * ============================================================ */

router.post('/config/gemini-key', requireAdmin, (req, res) => {
  const { apiKey, model } = req.body;

  if (apiKey) {
    geminiClient.setApiKey(apiKey.trim());
    if (model) geminiClient.model = model;
    res.json({ success: true, message: 'Gemini API Key updated successfully! Running in live Gemini 2.0 Flash mode.' });
  } else {
    res.json({ success: false, message: 'API key cannot be empty.' });
  }
});

router.post('/config/meta-keys', requireAdmin, (req, res) => {
  const { pageAccessToken, verifyToken, instagramAccountId, whatsappToken, whatsappPhoneId } = req.body;

  if (pageAccessToken) process.env.META_PAGE_ACCESS_TOKEN = pageAccessToken.trim();
  if (verifyToken) process.env.META_VERIFY_TOKEN = verifyToken.trim();
  if (instagramAccountId) process.env.INSTAGRAM_ACCOUNT_ID = instagramAccountId.trim();
  if (whatsappToken) process.env.WHATSAPP_ACCESS_TOKEN = whatsappToken.trim();
  if (whatsappPhoneId) process.env.WHATSAPP_PHONE_NUMBER_ID = whatsappPhoneId.trim();

  res.json({
    success: true,
    message: 'Meta Instagram & WhatsApp credentials saved live! Your webhooks are ready.'
  });
});

router.get('/network-info', requireAdmin, (req, res) => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let localIp = 'localhost';

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        if (!iface.address.startsWith('10.') || localIp === 'localhost') {
          localIp = iface.address;
        }
      }
    }
  }

  res.json({
    success: true,
    localIp,
    localUrl: `http://${localIp}:${process.env.PORT || 3000}`
  });
});

router.post('/test-meta-connection', requireAdmin, async (req, res) => {
  const token = req.body.token || process.env.META_PAGE_ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = req.body.phoneId || process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token) {
    return res.json({
      success: false,
      message: 'No Meta Access Token provided. Please paste your token starting with EAA... or IGAA...'
    });
  }

  try {
    const axios = require('axios');

    // 1. Instagram user token (IGAA / IGA)
    if (token.startsWith('IGA')) {
      try {
        const igUserRes = await axios.get(
          `https://graph.instagram.com/me?fields=id,username,name,account_type&access_token=${token}`
        );
        const igData = igUserRes.data;
        process.env.INSTAGRAM_ACCOUNT_ID = igData.id;

        return res.json({
          success: true,
          accountInfo: igData,
          instagramInfo: igData,
          message: `✅ Instagram Token is VALID! Connected to Instagram: @${igData.username || 'vanijyaasiddhiai'} (ID: ${igData.id})`
        });
      } catch (igTokenErr) {
        const errData = igTokenErr.response?.data?.error;
        return res.json({
          success: false,
          error: errData || igTokenErr.message,
          message: `❌ Instagram Token Error: ${errData?.message || igTokenErr.message}`
        });
      }
    }

    // 2. Facebook Page info
    const meRes = await axios.get(`https://graph.facebook.com/v19.0/me?access_token=${token}`);
    const pageName = meRes.data.name || 'Facebook Page';
    const pageId = meRes.data.id;

    // 3. Connected Instagram Business Account
    let igInfo = null;
    try {
      const igRes = await axios.get(
        `https://graph.facebook.com/v19.0/me?fields=instagram_business_account{id,username,name,profile_picture_url}&access_token=${token}`
      );
      if (igRes.data.instagram_business_account) {
        igInfo = igRes.data.instagram_business_account;
        process.env.INSTAGRAM_ACCOUNT_ID = igInfo.id;
      }
    } catch (igErr) {
      console.log('[Meta Diagnostic] Instagram Business Account lookup:', igErr.response?.data || igErr.message);
    }

    // 4. WhatsApp info
    let whatsappInfo = null;
    if (phoneId) {
      try {
        const waRes = await axios.get(`https://graph.facebook.com/v19.0/${phoneId}?access_token=${token}`);
        whatsappInfo = waRes.data;
      } catch (waErr) {
        whatsappInfo = { error: waErr.response?.data?.error?.message || waErr.message };
      }
    }

    let successMsg = `✅ Page Token is VALID! Connected to Page: "${pageName}" (ID: ${pageId})`;
    if (igInfo) successMsg += ` 📸 Connected Instagram: @${igInfo.username || igInfo.id}`;

    res.json({
      success: true,
      accountInfo: meRes.data,
      instagramInfo: igInfo,
      whatsappInfo,
      message: successMsg
    });
  } catch (err) {
    const metaError = err.response?.data?.error;
    res.json({
      success: false,
      error: metaError || err.message,
      message: `❌ Meta Token Error: ${metaError?.message || err.message} (Code: ${metaError?.code || 400})`
    });
  }
});

router.post('/send-live-test-message', requireAdmin, async (req, res) => {
  const { channel, recipient, text } = req.body;
  const axios = require('axios');

  if (!recipient || !text) {
    return res.status(400).json({ success: false, message: 'Recipient and text are required' });
  }

  try {
    if (channel === 'whatsapp') {
      const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
      const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

      if (!token || !phoneId) {
        return res.json({ success: false, message: 'Missing WhatsApp Access Token or Phone Number ID in settings.' });
      }

      const cleanPhone = recipient.replace(/[^0-9]/g, '');
      const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;

      const response = await axios.post(
        url,
        { messaging_product: 'whatsapp', to: cleanPhone, type: 'text', text: { body: text } },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      return res.json({
        success: true,
        message: `✅ Test WhatsApp message sent to +${cleanPhone}! Check your WhatsApp app.`,
        metaResponse: response.data
      });
    }

    const token = process.env.META_PAGE_ACCESS_TOKEN;

    if (!token) {
      return res.json({ success: false, message: 'Missing Meta Page Access Token in settings.' });
    }

    if (recipient.includes('instagram.com') || recipient.startsWith('@')) {
      return res.json({
        success: false,
        message:
          `💡 In Instagram API, you cannot send cold outbound DMs to a profile URL (@${recipient
            .replace(/.*instagram\.com\//, '')
            .replace('@', '')}).\nInstead, open Instagram on your phone and send a DM to your bot! Your bot will automatically reply in real time.`
      });
    }

    const baseUrl = token.startsWith('IGA')
      ? 'https://graph.instagram.com/v19.0/me/messages'
      : 'https://graph.facebook.com/v19.0/me/messages';

    const response = await axios.post(
      baseUrl,
      { recipient: { id: recipient.trim() }, message: { text } },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    return res.json({
      success: true,
      message: `✅ Test Instagram DM sent to ${recipient}!`,
      metaResponse: response.data
    });
  } catch (err) {
    const metaError = err.response?.data?.error;
    res.json({
      success: false,
      error: metaError || err.message,
      message: `❌ Meta API: ${metaError?.message || err.message}`
    });
  }
});

router.get('/webhook-logs', requireAdmin, (req, res) => {
  const webhook = require('./webhook');
  res.json({ success: true, logs: webhook.webhookLogs || [] });
});

module.exports = router;





