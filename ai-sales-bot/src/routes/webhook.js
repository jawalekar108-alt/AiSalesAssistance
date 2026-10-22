//21/10

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const conversationFlow = require('../engine/conversationFlow');
const whatsappBot = require('../engine/whatsappBot');
const db = require('../config/database');
const ig = require('../services/instagram');
const wa = require('../services/whatsapp');
const { buildWhatsAppLink } = require('../services/whatsappLink');
const { getSalon } = require('../salon/attach'); // beauty-parlour appointment bot

/* ============================================================
 * CONFIG
 * ============================================================ */

const DEFAULT_STORE_ID = process.env.DEFAULT_STORE_TYPE || 'clothing';

// public | dm | both
const COMMENT_REPLY_MODE = (process.env.COMMENT_REPLY_MODE || 'public').toLowerCase();

/* ============================================================
 * WEBHOOK LOGS
 * ============================================================ */

const webhookLogs = [];

function addWebhookLog(type, status, details, payload = null) {
  webhookLogs.unshift({
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toLocaleTimeString(),
    type,
    status,
    details,
    payload
  });

  if (webhookLogs.length > 100) webhookLogs.pop();
}

/* ============================================================
 * HELPERS
 * ============================================================ */

function cleanText(text) {
  if (text === null || text === undefined) return '';
  return String(text).trim();
}

function errorInfo(error) {
  return error.graph || error.response?.data || error.message;
}

// Says in the console WHY the "Chat on WhatsApp" button is (not) added
function describeWhatsAppButton(store, product) {
  let link = null;

  try {
    link = buildWhatsAppLink(store, product);
  } catch (error) {
    return `link error: ${error.message}`;
  }

  if (link) return 'ON (link ready)';
  if (!store.whatsapp_number) return `OFF - store ${store.id} has no WhatsApp number saved (save it in the dashboard, or run: node src/scripts/manage_accounts.js whatsapp ${store.id} 919876543210)`;
  if (store.whatsapp_link_enabled === false) return `OFF - "WhatsApp link" is switched off for store ${store.id}`;

  return 'OFF - whatsappLink.js returned no link';
}

// Sends the product picture as its own message (best effort: never blocks the text reply)
async function sendProductImage(store, recipientId, product) {
  const url = ig.publicImageUrl(product && typeof product === 'object' ? product.image_url : '');

  if (!url) return null;

  try {
    const sent = await ig.sendImageDM(store, recipientId, url);
    console.log('[Instagram] Product picture sent');
    return sent;
  } catch (error) {
    console.warn('[Instagram] Product picture not sent:', errorInfo(error));
    return null;
  }
}

/*
 * Which product should the WhatsApp button open?
 *   1) the product card of the AI reply
 *   2) the Instagram post the customer commented on (post -> product)
 *   3) the product this customer was last interested in
 */
function productForReply(store, result, mediaId, sessionId) {
  const card = result?.message?.product_cards?.[0];

  if (card?.id) {
    const byId = db.getProductById(card.id);
    if (byId && String(byId.store_id || byId.store_type) === String(store.id)) return byId;
  }

  if (card?.name) return card.name;

  if (mediaId) {
    const byMedia = db.getProductByInstagramId(mediaId);
    if (byMedia && String(byMedia.store_id || byMedia.store_type) === String(store.id)) return byMedia;
  }

  if (sessionId) {
    const interestedId = db.getConversation(sessionId, store.id)?.interested_product_id;
    const interested = interestedId ? db.getProductById(interestedId) : null;
    if (interested && String(interested.store_id || interested.store_type) === String(store.id)) return interested;
  }

  return null;
}

/*
 * Signature check. Instagram and WhatsApp can belong to different
 * Meta apps with different secrets, so every configured secret is tried.
 *
 * Returns:  true  = signature is valid
 *           false = a signature was sent but it does not match
 *           null  = it could not be checked (no secret configured, no header, or no raw body)
 *
 * Set ENFORCE_WEBHOOK_SIGNATURE=true to reject everything that is not `true`
 * (a request with NO signature header is rejected too, so it cannot be forged by leaving the header out).
 * Until enforced, problems are only logged.
 */
function verifySignature(req) {
  const sig = req.get('x-hub-signature-256');

  const appSecrets = [
    process.env.INSTAGRAM_APP_SECRET,
    process.env.META_APP_SECRET,
    process.env.WHATSAPP_APP_SECRET
  ].filter(Boolean);

  if (!appSecrets.length || !sig || !req.rawBody) return null;

  return appSecrets.some(secret => {
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

/*
 * Instagram tenant resolution:
 * webhook entry.id  ->  store.instagram_user_id (or instagram_scoped_id)
 *
 * Legacy single-tenant mode: while NO store has connected Instagram yet, events go
 * to the default store (so your current .env-token setup keeps working).
 * After the first tenant connects, unknown accounts are rejected.
 */
function getStoreFromInstagramEntry(entry) {
  const id = entry?.id ? String(entry.id) : null;

  const store = ig.findStoreByInstagramId(id);
  if (store) return store;

  const anyConnected = db.getStores().some(s => s.instagram_user_id);

  if (!anyConnected) {
    console.warn('[SaaS] No tenant connected yet - using legacy default store:', DEFAULT_STORE_ID);
    return db.getStore(DEFAULT_STORE_ID);
  }

  return null;
}

/*
 * WhatsApp tenant resolution:
 * webhook metadata.phone_number_id  ->  store.whatsapp_phone_number_id
 *
 * Legacy single-tenant mode: while NO store has saved a WhatsApp phone number id,
 * messages go to the default store (uses the .env WhatsApp settings).
 */
function getStoreFromWhatsAppValue(value) {
  const phoneId = value?.metadata?.phone_number_id ? String(value.metadata.phone_number_id) : '';

  const store = wa.findStoreByPhoneNumberId(phoneId);
  if (store) return store;

  const anyConnected = db.getStores().some(s => s.whatsapp_phone_number_id);

  if (!anyConnected) {
    console.warn('[SaaS] No tenant has WhatsApp yet - using legacy default store:', DEFAULT_STORE_ID);
    return db.getStore(DEFAULT_STORE_ID);
  }

  return null;
}

/* ============================================================
 * TEST / LOGS / VERIFY
 * ============================================================ */

router.get('/test', (req, res) => {
  res.json({ success: true, message: 'Webhook is reachable', timestamp: new Date().toISOString() });
});

// NOTE: server.js declares an admin-only /webhook/logs BEFORE this router,
// so this one is never reached. Kept so the router still works on its own.
router.get('/logs', (req, res) => {
  res.json({ success: true, logs: webhookLogs });
});

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // TODO (before real clients): set META_VERIFY_TOKEN in .env, then delete the two hard-coded tokens below.
  const validTokens = [
    process.env.META_VERIFY_TOKEN,
    'ai_sales_automation_2026',
    'ai_sales_bot_secret_token_2026'
  ].filter(Boolean);

  if (mode === 'subscribe' && token && validTokens.includes(token)) {
    console.log('[Meta Webhook] VERIFIED');
    addWebhookLog('HANDSHAKE', 'SUCCESS', 'Meta webhook verified');
    return res.status(200).send(challenge);
  }

  console.warn('[Meta Webhook] Verification failed');
  addWebhookLog('HANDSHAKE', 'FAILED', 'Webhook verification failed');
  return res.sendStatus(403);
});

/* ============================================================
 * MAIN WEBHOOK
 * ============================================================ */

router.post('/', async (req, res) => {
  const sigOk = verifySignature(req);
  const enforce = process.env.ENFORCE_WEBHOOK_SIGNATURE === 'true';

  if (sigOk === false) {
    console.warn('[Meta Webhook] Invalid X-Hub-Signature-256');
  } else if (sigOk === null) {
    console.warn('[Meta Webhook] Signature could not be checked (no header, no app secret, or no raw body)');
  }

  // When enforcing, ONLY a valid signature is accepted
  if (enforce && sigOk !== true) {
    return res.sendStatus(401);
  }

  // Always acknowledge Meta immediately
  res.status(200).send('EVENT_RECEIVED');

  const body = req.body || {};

  console.log(`\n[META WEBHOOK RECEIVED] object=${body.object} entries=${(body.entry || []).length}`);

  // The full payload contains customers' phone numbers and messages: only dump it outside production
  if (process.env.NODE_ENV !== 'production') {
    console.dir(body, { depth: 8 });
  }

  try {
    if (body.object === 'whatsapp_business_account') {
      // Messages sent to a BEAUTY PARLOUR number are answered by the appointment bot.
      // Everything else continues to the sales bot below. If the parlour check fails, sales are never blocked.
      const salon = getSalon();
      const isParlour = salon ? await salon.owns(body).catch(() => false) : false;

      if (isParlour) {
        await salon.process(body);
        return;
      }

      await handleWhatsAppWebhook(body);
      return;
    }

    if (body.object === 'instagram' || body.object === 'page') {
      await handleInstagramWebhook(body);
      return;
    }

    console.log('[Meta Webhook] Unknown object:', body.object);
  } catch (error) {
    console.error('[Meta Webhook] Unhandled error:', error.message);
  }
});

/* ============================================================
 * INSTAGRAM
 * ============================================================ */

async function handleInstagramWebhook(body) {
  for (const entry of body.entry || []) {
    const store = getStoreFromInstagramEntry(entry);

    if (!store) {
      console.error('[SaaS] Unknown Instagram account:', entry?.id);
      addWebhookLog('INSTAGRAM_IN', 'FAILED', `Unknown Instagram account: ${entry?.id}`);
      continue;
    }

    if (store.status !== 'active' || store.ai_enabled === false) {
      console.log(`[SaaS] Store ${store.id} is inactive or AI disabled`);
      continue;
    }

    // DMs
    for (const messagingEvent of entry.messaging || []) {
      await processInstagramMessagingEvent(messagingEvent, store, entry.id);
    }

    // Comments
    for (const change of entry.changes || []) {
      if (change.field === 'comments' || change.field === 'live_comments') {
        await processInstagramComment(change.value || {}, store, entry.id);
      }
    }
  }
}

async function processInstagramMessagingEvent(event, store, entryId) {
  if (!event) return;

  if (store.dm_reply_enabled === false) return;

  // Ignore messages sent by our own account
  if (event.message?.is_echo) return;

  const senderId = event.sender?.id ? String(event.sender.id) : null;
  if (!senderId) return;

  if (
    senderId === String(entryId) ||
    senderId === String(store.instagram_user_id || '') ||
    senderId === String(store.instagram_scoped_id || '')
  ) {
    return;
  }

  // Webhook retry protection
  const mid = event.message?.mid;

  if (mid) {
    const key = `instagram_dm_${store.id}_${mid}`;
    if (db.hasProcessedWebhookEvent(key)) {
      console.log('[Instagram DM] Duplicate ignored:', mid);
      return;
    }
    db.markWebhookEventProcessed(key, store.id);
  }

  const storeType = store.type || store.id || 'clothing';
  const sessionId = `ig_${store.id}_${senderId}`;

  try {
    // Ad / referral
    if (event.referral) {
      const ref = event.referral;

      const result = await conversationFlow.handleAdReferral({
        sessionId,
        storeId: store.id,
        storeType,
        adCampaignId: ref.ad_id || ref.ref || 'instagram_ad',
        adName: ref.ref || 'Instagram Product',
        platform: 'instagram_dm'
      });

      const replyText = cleanText(result?.message?.text);

      if (replyText) {
        await ig.sendDMWithWhatsApp(store, senderId, replyText, productForReply(store, result, null, sessionId));
      }

      return;
    }

    if (!event.message) return;

    const userText = cleanText(event.message.text || event.message.quick_reply?.payload);
    if (!userText) return;

    console.log(`[Instagram DM] [${store.id}] Incoming from ${senderId}: "${userText}"`);
    addWebhookLog('INSTAGRAM_IN', 'SUCCESS', `Instagram DM from ${senderId}`, { text: userText });

    const result = await conversationFlow.handleMessage({
      sessionId,
      userText,
      storeType,
      storeId: store.id,
      platform: 'instagram_dm',
      metadata: {
        customer_handle: senderId,
        instagram_user_id: senderId
      }
    });

    const replyText = cleanText(result?.message?.text);

    if (!replyText) {
      console.warn('[Instagram DM] AI returned empty response');
      return;
    }

    console.log(`[Instagram DM] AI reply: "${replyText}"`);
    console.log('[Instagram DM] Sending reply...', {
      recipientId: senderId,
      credentials: ig.describeCredentials(store)
    });

    // Adds the "Chat on WhatsApp" button (only if the store has a WhatsApp number saved)
    const dmProduct = productForReply(store, result, null, sessionId);

    console.log('[Instagram DM] WhatsApp button:', describeWhatsAppButton(store, dmProduct));

    const sent = await ig.sendDMWithWhatsApp(store, senderId, replyText, dmProduct);

    console.log('[Instagram DM] Reply sent', sent);
    addWebhookLog('META_DISPATCH', 'SUCCESS', `Instagram DM sent to ${senderId}`, sent);

    if (result?.message?.wants_image) await sendProductImage(store, senderId, dmProduct);
  } catch (error) {
    console.error('[Instagram DM] ERROR:', errorInfo(error));
    addWebhookLog('META_DISPATCH', 'FAILED', `Instagram DM failed: ${error.message}`, errorInfo(error));
  }
}

async function processInstagramComment(value, store, entryId) {
  if (store.comment_reply_enabled === false) return;

  const commentId = value?.id || value?.comment_id;
  const commentText = cleanText(value?.text || value?.message);
  const commenterId = value?.from?.id || value?.from?.user_id || value?.user_id;
  const commenterName = value?.from?.username || value?.username || 'Instagram Customer';
  const mediaId = value?.media?.id || value?.media_id;

  if (!commentId || !commentText) return;

  // Never answer our own comments (including our own bot replies)
  const ownIds = [entryId, store.instagram_user_id, store.instagram_scoped_id].filter(Boolean).map(String);

  if (commenterId && ownIds.includes(String(commenterId))) {
    console.log('[SaaS] Ignoring our own Instagram comment');
    return;
  }

  const ownUsername = String(store.instagram_username || '').replace(/^@/, '').toLowerCase();
  const incomingUsername = String(commenterName || '').replace(/^@/, '').toLowerCase();

  if (ownUsername && ownUsername === incomingUsername) return;

  if (db.hasOurInstagramReplyId(commentId)) return;

  const eventKey = `instagram_comment_${store.id}_${commentId}`;

  if (db.hasProcessedWebhookEvent(eventKey)) {
    console.log('[SaaS] Duplicate comment ignored:', commentId);
    return;
  }

  db.markWebhookEventProcessed(eventKey, store.id);

  console.log('[Instagram Comment]', { store: store.id, commentId, commenterId, commenterName, mediaId, commentText });
  addWebhookLog('INSTAGRAM_IN', 'SUCCESS', `Instagram comment from ${commenterName}`, {
    commentId,
    commenterId,
    mediaId,
    text: commentText
  });

  try {
    const storeType = store.type || store.id || 'clothing';

    const result = await conversationFlow.handleMessage({
      sessionId: commenterId
        ? `ig_${store.id}_${commenterId}`
        : `ig_${store.id}_comment_${commentId}`,
      storeId: store.id,
      userText: commentText,
      storeType,
      platform: 'instagram_comment',
      metadata: {
        customer_name: commenterName,
        customer_handle: commenterId || commenterName,
        instagram_user_id: commenterId || null,
        instagram_comment_id: commentId,
        instagram_media_id: mediaId || null
      }
    });

    const replyText =
      cleanText(result?.message?.text) ||
      'Thanks for your comment! Please send us a DM and we will help you with the product. 😊';

    console.log(`[Instagram Comment] AI reply: "${replyText}"`);
    console.log('[Instagram Comment] Sending reply...', {
      commentId,
      mode: COMMENT_REPLY_MODE,
      credentials: ig.describeCredentials(store)
    });

    const waProduct = productForReply(
      store,
      result,
      mediaId,
      commenterId ? `ig_${store.id}_${commenterId}` : null
    );

    console.log('[Instagram Comment] WhatsApp button:', describeWhatsAppButton(store, waProduct));

    // Public reply
    if (COMMENT_REPLY_MODE === 'public' || COMMENT_REPLY_MODE === 'both') {
      try {
        let publicText =
          COMMENT_REPLY_MODE === 'both'
            ? 'Thanks for your interest! We have sent you the details in DM 📩'
            : replyText;

        // Comments cannot have buttons. COMMENT_PUBLIC_LINK=true adds the WhatsApp link as text.
        if (process.env.COMMENT_PUBLIC_LINK === 'true') {
          const link = buildWhatsAppLink(store, waProduct);
          if (link) publicText += `\n💬 Chat on WhatsApp: ${link}`;
        }

        const sent = await ig.replyToComment(store, commentId, publicText);

        if (sent?.id) db.saveOurInstagramReplyId(sent.id, store.id);

        addWebhookLog('META_DISPATCH', 'SUCCESS', `Comment reply sent to ${commentId}`, sent);
      } catch (error) {
        console.error('[Instagram Comment Reply ERROR]', errorInfo(error));
        addWebhookLog('META_DISPATCH', 'FAILED', `Comment reply failed: ${error.message}`, errorInfo(error));
      }
    }

    // Private reply (DM)
    if (COMMENT_REPLY_MODE === 'dm' || COMMENT_REPLY_MODE === 'both') {
      try {
        const sent = await ig.privateReplyWithWhatsApp(store, commentId, replyText, waProduct);
        addWebhookLog('META_DISPATCH', 'SUCCESS', `Private reply sent for comment ${commentId}`, sent);

        // "Send me the full image": follow the text with the picture (needs the customer's Instagram id)
        if (result?.message?.wants_image && commenterId) await sendProductImage(store, commenterId, waProduct);
      } catch (error) {
        console.error('[Instagram Private Reply ERROR]', errorInfo(error));
        addWebhookLog('META_DISPATCH', 'FAILED', `Private reply failed: ${error.message}`, errorInfo(error));
      }
    }
  } catch (error) {
    console.error('[Instagram Comment ERROR]', errorInfo(error));
    addWebhookLog('INSTAGRAM_IN', 'FAILED', `Instagram comment failed: ${error.message}`, errorInfo(error));
  }
}

/* ============================================================
 * WHATSAPP  (multi-tenant: every business has its own number)
 * ============================================================ */

async function handleWhatsAppWebhook(body) {
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;

      const value = change.value || {};
      const contacts = value.contacts || [];

      // Delivery problems (for example a picture WhatsApp could not load)
      // arrive as "statuses". Log failures so they are not silent.
      for (const status of value.statuses || []) {
        if (status.status === 'failed') {
          const err = (status.errors || [])[0] || {};
          console.error(
            `[WhatsApp] DELIVERY FAILED to ${status.recipient_id}: code=${err.code} ${err.title || ''} ${err.message || ''}`
          );
          addWebhookLog('WHATSAPP_OUT', 'FAILED', `Delivery failed: ${err.code} ${err.title || err.message || ''}`, err);
        }
      }

      const store = getStoreFromWhatsAppValue(value);

      if (!store) {
        const phoneId = value?.metadata?.phone_number_id;
        console.error('[SaaS] Unknown WhatsApp phone_number_id:', phoneId);
        addWebhookLog('WHATSAPP_IN', 'FAILED', `Unknown WhatsApp phone_number_id: ${phoneId}`);
        continue;
      }

      // (Inactive-store and duplicate-message checks happen inside whatsappBot.handleIncoming)

      // "messages" = customer messages. Delivery/read receipts arrive as "statuses".
      for (const message of value.messages || []) {
        const contact = contacts.find(c => c.wa_id === message.from) || contacts[0];

        console.log(`[WhatsApp] [${store.id}] Incoming from ${message.from}: type=${message.type}`);
        addWebhookLog('WHATSAPP_IN', 'SUCCESS', `WhatsApp ${message.type} from ${message.from}`, {
          store: store.id,
          type: message.type
        });

        try {
          await whatsappBot.handleIncoming({ store, message, contact });
        } catch (error) {
          console.error('[WhatsApp] Processing error:', errorInfo(error));
          addWebhookLog('WHATSAPP_IN', 'FAILED', error.message, error.graph || null);
        }
      }
    }
  }
}

module.exports = router;
module.exports.webhookLogs = webhookLogs;
module.exports.addWebhookLog = addWebhookLog;

