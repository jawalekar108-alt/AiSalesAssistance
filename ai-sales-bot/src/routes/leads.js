//6/10 multi tenant

const express = require('express');
const router = express.Router();
const db = require('../config/database');

/*
 * TENANT RESOLUTION
 *
 * Logged-in business owners: req.user.store_id is forced by the login (see services/auth.js),
 * so they can only ever read their own store.
 * Admin (req.user.store_id is empty): may pick any store with ?store_id= / x-store-id.
 */
function getStoreId(req) {
  return (
    req.user?.store_id ||
    req.headers['x-store-id'] ||
    req.query.store_id ||
    req.body?.store_id ||
    null
  );
}

function requireStore(req, res) {
  const storeId = getStoreId(req);

  if (!storeId) {
    res.status(400).json({
      success: false,
      message: 'store_id is required'
    });
    return null;
  }

  const store = db.getStore(storeId);

  if (!store) {
    res.status(404).json({
      success: false,
      message: 'Store not found'
    });
    return null;
  }

  return store;
}

function belongsToStore(item, storeId) {
  return String(
    item.store_id || item.store_type || ''
  ) === String(storeId);
}

// ============================================================
// GET LEADS
// ============================================================

router.get('/leads', (req, res) => {
  try {
    const store = requireStore(req, res);
    if (!store) return;

    const leads = db
      .getLeads(store.id)
      .filter(lead => belongsToStore(lead, store.id));

    res.json({
      success: true,
      store: {
        id: store.id,
        business_name: store.business_name || store.name,
        instagram_username: store.instagram_username || null
      },
      leads
    });
  } catch (error) {
    console.error('[Leads GET]', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ============================================================
// UPDATE LEAD
// ============================================================

router.put('/leads/:id', (req, res) => {
  try {
    const store = requireStore(req, res);
    if (!store) return;

    const existingLead = db.data.leads.find(lead =>
      String(lead.id) === String(req.params.id) &&
      belongsToStore(lead, store.id)
    );

    if (!existingLead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found'
      });
    }

    const updated = db.saveOrUpdateLead(
      existingLead.conversation_id,
      {
        ...req.body,
        store_id: store.id
      }
    );

    res.json({
      success: true,
      lead: updated
    });
  } catch (error) {
    console.error('[Leads UPDATE]', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ============================================================
// ANALYTICS
// ============================================================

router.get('/analytics', (req, res) => {
  try {
    const store = requireStore(req, res);
    if (!store) return;

    const conversations = db
      .getRecentConversations(100000, store.id)
      .filter(conversation =>
        belongsToStore(conversation, store.id)
      );

    const messages = db.data.messages.filter(message =>
      String(message.store_id || '') === String(store.id)
    );

    const leads = db
      .getLeads(store.id)
      .filter(lead => belongsToStore(lead, store.id));

    const convertedLeads = leads.filter(
      lead => lead.status === 'PURCHASED'
    ).length;

    const hotLeads = leads.filter(
      lead => lead.intent_score === 'HOT'
    ).length;

    const checkoutClickedLeads = leads.filter(
      lead => lead.status === 'CHECKOUT_CLICKED'
    ).length;

    const totalRevenue = leads.reduce(
      (sum, lead) =>
        lead.status === 'PURCHASED'
          ? sum + (Number(lead.cart_value) || 0)
          : sum,
      0
    );

    res.json({
      success: true,
      analytics: {
        totalConversations: conversations.length,
        totalMessages: messages.length,
        totalLeads: leads.length,
        convertedLeads,
        checkoutClickedLeads,
        hotLeads,
        conversionRate:
          leads.length > 0
            ? `${((convertedLeads / leads.length) * 100).toFixed(1)}%`
            : '0%',
        totalRevenue:
          `${store.currency || process.env.CURRENCY_SYMBOL || '₹'}${totalRevenue.toFixed(2)}`,
        totalProducts:
          db.getProducts(store.id).length,
        instagramProducts:
          db.getProducts(store.id).filter(
            product => product.source === 'instagram'
          ).length
      }
    });
  } catch (error) {
    console.error('[Analytics]', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ============================================================
// GET RECENT CONVERSATIONS
// ============================================================

router.get('/conversations', (req, res) => {
  try {
    const store = requireStore(req, res);
    if (!store) return;

    const conversations = db
      .getRecentConversations(1000, store.id)
      .filter(conversation =>
        belongsToStore(conversation, store.id)
      )
      .map(conversation => ({
        ...conversation,
        session_id:
          conversation.session_id,
        conversation_id:
          conversation.session_id
      }));

    res.json({
      success: true,
      conversations
    });
  } catch (error) {
    console.error('[Inbox Conversations]', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ============================================================
// GET CONVERSATION MESSAGES
// ============================================================

router.get(
  '/conversations/:sessionId/messages',
  (req, res) => {
    try {
      const store = requireStore(req, res);
      if (!store) return;

      const conversation = db.data.conversations.find(item =>
        item.session_id === req.params.sessionId &&
        belongsToStore(item, store.id)
      );

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: 'Conversation not found'
        });
      }

      const messages = db
        .getMessages(req.params.sessionId, store.id)
        .filter(message =>
          String(message.store_id || '') === String(store.id)
        );

      res.json({
        success: true,
        messages
      });
    } catch (error) {
      console.error('[Inbox Messages]', error);
      res.status(500).json({
        success: false,
        message: 'Failed to load conversation messages'
      });
    }
  }
);

// ============================================================
// STORES  (a business owner only sees their own store)
// ============================================================

router.get('/stores', (req, res) => {
  try {
    let list = db.getStores();

    if (req.user?.store_id) {
      list = list.filter(store => String(store.id) === String(req.user.store_id));
    }

    const stores = list.map(store => ({
      id: store.id,
      business_name: store.business_name || store.name,
      type: store.type,
      instagram_username: store.instagram_username || null,
      instagram_user_id: store.instagram_user_id || null,
      status: store.status || 'active',
      ai_enabled: store.ai_enabled !== false,
      comment_reply_enabled:
        store.comment_reply_enabled !== false,
      dm_reply_enabled:
        store.dm_reply_enabled !== false,
      instagram_connected: Boolean(
        store.instagram_user_id &&
        store.instagram_access_token
      )
    }));

    res.json({
      success: true,
      stores
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ============================================================
// GET SINGLE STORE - SAFE DATA ONLY
// ============================================================

router.get('/stores/:storeId', (req, res) => {
  try {
    const store = db.getStore(req.params.storeId);

    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    if (req.user?.store_id && String(req.user.store_id) !== String(store.id)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden'
      });
    }

    res.json({
      success: true,
      store: {
        id: store.id,
        business_name: store.business_name || store.name,
        type: store.type,
        instagram_username: store.instagram_username || null,
        instagram_user_id: store.instagram_user_id || null,
        status: store.status || 'active',
        ai_enabled: store.ai_enabled !== false,
        comment_reply_enabled:
          store.comment_reply_enabled !== false,
        dm_reply_enabled:
          store.dm_reply_enabled !== false
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;


