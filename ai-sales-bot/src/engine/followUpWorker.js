const db = require('../config/database');
const ig = require('../services/instagram');

// ============================================================
// CONFIGURATION
// ============================================================

const POLL_INTERVAL = Number(process.env.FOLLOW_UP_POLL_INTERVAL_MS) || 30000;

const DEFAULT_COUPON = process.env.DEFAULT_FOLLOW_UP_COUPON || 'FLASH15';

// ============================================================
// FOLLOW-UP TEMPLATES
// ============================================================

const FOLLOW_UP_TEMPLATES = {
  1: {
    clothing:
      'Hey! 👋 Just checking in. Are you still interested in this product? I can help with size, color, price, or availability.',
    electronics:
      'Hey! 👋 Just checking in. Are you still interested in this product? I can help with price, availability, features, or ordering.'
  },

  2: {
    clothing:
      'Still thinking about it? 😊 If you want, I can help you choose the right size or color and guide you to checkout.',
    electronics:
      'Still thinking about it? 😊 I can help you compare the product details, availability, and ordering options.'
  },

  3: {
    clothing:
      'Last follow-up from us ❤️ If you are still interested, reply here and I’ll help you complete your order.',
    electronics:
      'Last follow-up from us ❤️ If you are still interested, reply here and I’ll help you complete your order.'
  }
};

// ============================================================
// WORKER
// ============================================================

class FollowUpWorker {
  constructor() {
    this.isRunning = false;
    this.timer = null;
    this.processing = false;
  }

  start() {
    if (this.isRunning) {
      console.log('[FollowUpWorker] Already running');
      return;
    }

    this.isRunning = true;

    console.log('[FollowUpWorker] 🚀 Started');
    console.log(`[FollowUpWorker] Poll interval: ${POLL_INTERVAL}ms`);

    this.timer = setInterval(() => {
      this.processPending().catch(error => {
        console.error('[FollowUpWorker] Process error:', error.message);
      });
    }, POLL_INTERVAL);

    this.processPending().catch(error => {
      console.error('[FollowUpWorker] Initial process error:', error.message);
    });
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.isRunning = false;
    console.log('[FollowUpWorker] 🛑 Stopped');
  }

  async processPending() {
    if (this.processing) return;

    this.processing = true;

    try {
      const pending = db.getPendingFollowUps();

      if (!pending.length) return;

      console.log(`[FollowUpWorker] ${pending.length} pending follow-up(s)`);

      for (const followUp of pending) {
        try {
          await this.executeFollowUp(followUp);
        } catch (error) {
          console.error(`[FollowUpWorker] Follow-up ${followUp.id} failed:`, error.message);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  // ==========================================================
  // EXECUTE ONE FOLLOW-UP
  // ==========================================================

  async executeFollowUp(followUp) {
    if (!followUp) return null;

    const sessionId = followUp.conversation_id;

    const conversation = db.getConversation(sessionId);

    if (!conversation) {
      db.markFollowUpExecuted(followUp.id, false, { error: 'Conversation not found' });
      return null;
    }

    // Never follow up after purchase
    const lead = db.getLeadBySession(sessionId);

    if (lead?.status === 'PURCHASED' || conversation.stage === 'CONVERTED') {
      db.markFollowUpExecuted(followUp.id, false, {
        cancelled: true,
        cancelled_reason: 'Customer already purchased'
      });

      console.log(`[FollowUpWorker] Follow-up ${followUp.id} cancelled: customer already purchased`);
      return null;
    }

    // Tenant store (multi-tenant: use store_id first)
    const store = db.getStore(conversation.store_id || conversation.store_type);

    const product = conversation.interested_product_id
      ? db.getProductById(conversation.interested_product_id)
      : null;

    const stage = Number(followUp.stage) || 1;
    const storeType = conversation.store_type || 'clothing';

    const template =
      FOLLOW_UP_TEMPLATES[stage]?.[storeType] || FOLLOW_UP_TEMPLATES[1].clothing;

    const couponCode =
      conversation.claimed_coupon || store?.active_promo_code || DEFAULT_COUPON;

    let followUpText = template;

    if (followUp.custom_prompt) followUpText = followUp.custom_prompt;

    if (product?.name) followUpText += `\n\n🛍️ Product: ${product.name}`;

    const hasConfiguredPromo =
      Boolean(store?.active_promo_code) || Boolean(conversation.claimed_coupon);

    if (hasConfiguredPromo && couponCode) {
      followUpText += `\n\nUse code ${couponCode} if you would like to order.`;
    }

    // Checkout button
    const checkoutUrl = buildCheckoutUrl(product?.checkout_url, couponCode, hasConfiguredPromo);

    const actionButtons = checkoutUrl
      ? [
          {
            label: hasConfiguredPromo ? `🔥 Buy with ${couponCode}` : '🔥 Buy now',
            url: checkoutUrl
          }
        ]
      : [];

    // Save internal message
    const savedMessage = db.addMessage(sessionId, 'bot', followUpText, {
      quick_replies: ['Price', 'Sizes', 'Colors', 'Order'],
      product_cards: product ? [createProductCard(product)] : [],
      action_buttons: actionButtons,
      platform: conversation.platform || 'simulator',
      follow_up_id: followUp.id,
      follow_up_stage: stage
    });

    // Send on Instagram (uses THIS tenant's token)
    let externalSent = true;
    let externalError = null;
    let externalResponse = null;

    if (conversation.platform === 'instagram_dm') {
      const recipientId =
        conversation.instagram_user_id ||
        extractInstagramRecipientId(conversation.session_id);

      if (!recipientId) {
        externalSent = false;
        externalError = 'Instagram recipient ID is missing';

        console.error(`[FollowUpWorker] Cannot send follow-up ${followUp.id}: ${externalError}`);
      } else if (!store) {
        externalSent = false;
        externalError = 'Store not found for conversation';

        console.error(`[FollowUpWorker] Cannot send follow-up ${followUp.id}: ${externalError}`);
      } else {
        try {
          externalResponse = await ig.sendDM(store, recipientId, followUpText);

          console.log(`[FollowUpWorker] Instagram follow-up ${followUp.id} sent successfully`);
        } catch (error) {
          externalSent = false;
          externalError = error.graph || error.response?.data || error.message;

          console.error('[FollowUpWorker] Instagram send failed:', formatError(externalError));
        }
      }
    }

    db.markFollowUpExecuted(followUp.id, externalSent, {
      message_id: savedMessage?.id || null,
      external_sent: externalSent,
      external_error: externalError ? formatError(externalError) : null,
      external_response: externalResponse || null
    });

    if (externalSent) {
      await this.scheduleNextStage(conversation, stage);
    }

    return savedMessage;
  }

  // ==========================================================
  // SCHEDULE NEXT FOLLOW-UP
  // ==========================================================

  async scheduleNextStage(conversation, currentStage) {
    if (currentStage >= 3) return;

    const nextStage = currentStage + 1;

    let delayMinutes;

    if (process.env.NODE_ENV === 'test') {
      delayMinutes = nextStage === 2 ? 2 : 5;
    } else {
      // Instagram only allows replies within 24h of the customer's last message,
      // so stage 3 must stay inside that window (120 min, then 18 h).
      delayMinutes = nextStage === 2 ? 120 : 1080;
    }

    db.scheduleFollowUp(conversation.session_id, nextStage, delayMinutes);

    db.updateConversation(conversation.session_id, {
      follow_up_count: Number(conversation.follow_up_count || 0) + 1
    });

    console.log(
      `[FollowUpWorker] Scheduled stage ${nextStage} for ${conversation.session_id} in ${delayMinutes} minutes`
    );
  }
}

// ============================================================
// HELPERS
// ============================================================

// Sessions look like: ig_<storeId>_<instagramUserId>
function extractInstagramRecipientId(sessionId) {
  if (!sessionId) return null;

  const last = String(sessionId).trim().split('_').pop();

  return /^\d+$/.test(last) ? last : null;
}

function buildCheckoutUrl(checkoutUrl, couponCode, useCoupon) {
  if (!checkoutUrl) return null;

  try {
    const url = new URL(String(checkoutUrl));

    if (useCoupon && couponCode) {
      url.searchParams.set('coupon', couponCode);
    }

    return url.toString();
  } catch (error) {
    console.warn('[FollowUpWorker] Invalid checkout URL:', checkoutUrl);
    return null;
  }
}

function createProductCard(product) {
  if (!product) return null;

  return {
    id: product.id,
    name: product.name || 'Product',
    price: product.price ?? null,
    original_price: product.original_price ?? null,
    image_url: product.image_url || '',
    category: product.category || '',
    stock: product.stock ?? null,
    sizes: Array.isArray(product.sizes) ? product.sizes : [],
    colors: Array.isArray(product.colors) ? product.colors : [],
    checkout_url: product.checkout_url || '',
    instagram_url: product.instagram_url || ''
  };
}

function formatError(error) {
  if (!error) return null;

  if (typeof error === 'string') return error;

  if (error.response?.data) {
    try {
      return JSON.stringify(error.response.data);
    } catch {
      return String(error.response.data);
    }
  }

  if (error.message) return error.message;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

module.exports = new FollowUpWorker();
