//4/10
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/sales_bot_db.json');

// ============================================================
// INITIAL DATABASE
// ============================================================

const initialData = {
  stores: [
    {
      id: 'clothing',
      name: 'Instagram Clothing Store',
      business_name: 'Instagram Clothing Store',
      type: 'clothing',
      instagram_user_id: null,
      instagram_username: null,
      instagram_access_token: null,
      status: 'active',
      ai_enabled: true,
      comment_reply_enabled: true,
      dm_reply_enabled: true,
      currency: process.env.CURRENCY_SYMBOL || '₹',
      active_promo_code: '',
      promo_discount_percent: 0,
      urgency_timer_minutes: 20,
      free_shipping_threshold: 0,
      return_policy:
        'Please contact the store for return and exchange policy',
      social_proof: {
        recent_purchases_24h: 0,
        live_viewers: 0,
        rating: 0,
        reviews_count: 0
      }
    },

    {
      id: 'electronics',
      name: 'Instagram Electronics Store',
      business_name: 'Instagram Electronics Store',
      type: 'electronics',
      instagram_user_id: null,
      instagram_username: null,
      instagram_access_token: null,
      status: 'active',
      ai_enabled: true,
      comment_reply_enabled: true,
      dm_reply_enabled: true,
      currency: process.env.CURRENCY_SYMBOL || '₹',
      active_promo_code: '',
      promo_discount_percent: 0,
      urgency_timer_minutes: 30,
      free_shipping_threshold: 0,
      warranty_policy:
        'Please contact the store for warranty information',
      social_proof: {
        recent_purchases_24h: 0,
        live_viewers: 0,
        rating: 0,
        reviews_count: 0
      }
    }
  ],

  // Products come from Instagram sync or manual catalog entry.
  products: [],

  conversations: [],
  messages: [],
  leads: [],
  follow_ups: [],
  processed_webhook_events: [],
  our_instagram_reply_ids: []
};

// ============================================================
// CREATE DATA DIRECTORY
// ============================================================

const dataDir = path.dirname(DB_PATH);

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, {
    recursive: true
  });
}

// ============================================================
// DATABASE CLASS
// ============================================================

class Database {
  constructor() {
    this.data = this.loadData();
  }

  // ==========================================================
  // LOAD DATABASE
  // ==========================================================

  loadData() {
    try {
      if (fs.existsSync(DB_PATH)) {
        const raw = fs.readFileSync(DB_PATH, 'utf8');

        if (!raw.trim()) {
          throw new Error('Database file is empty');
        }

        const parsed = JSON.parse(raw);

        parsed.stores = Array.isArray(parsed.stores)
          ? parsed.stores
          : JSON.parse(
              JSON.stringify(initialData.stores)
            );

        parsed.products = Array.isArray(parsed.products)
          ? parsed.products
          : [];

        parsed.conversations =
          Array.isArray(parsed.conversations)
            ? parsed.conversations
            : [];

        parsed.messages = Array.isArray(parsed.messages)
          ? parsed.messages
          : [];

        parsed.leads = Array.isArray(parsed.leads)
          ? parsed.leads
          : [];

        parsed.follow_ups =
          Array.isArray(parsed.follow_ups)
            ? parsed.follow_ups
            : [];

        parsed.processed_webhook_events =
          Array.isArray(parsed.processed_webhook_events)
            ? parsed.processed_webhook_events
            : [];

        parsed.our_instagram_reply_ids =
          Array.isArray(parsed.our_instagram_reply_ids)
            ? parsed.our_instagram_reply_ids
            : [];

        parsed.stores = parsed.stores.map(store => ({
          ...store,
          business_name: store.business_name || store.name || 'Business',
          instagram_user_id: store.instagram_user_id || null,
          instagram_username: store.instagram_username || null,
          instagram_access_token: store.instagram_access_token || null,
          status: store.status || 'active',
          ai_enabled: store.ai_enabled !== false,
          comment_reply_enabled: store.comment_reply_enabled !== false,
          dm_reply_enabled: store.dm_reply_enabled !== false
        }));

        const defaultStoreId =
          parsed.stores[0]?.id || 'clothing';

        parsed.products = parsed.products.map(product => ({
          ...product,
          store_id: product.store_id || product.store_type || defaultStoreId
        }));

        parsed.conversations = parsed.conversations.map(conversation => ({
          ...conversation,
          store_id: conversation.store_id || conversation.store_type || defaultStoreId
        }));

        parsed.messages = parsed.messages.map(message => ({
          ...message,
          store_id: message.store_id || defaultStoreId
        }));

        parsed.leads = parsed.leads.map(lead => ({
          ...lead,
          store_id: lead.store_id || lead.store_type || defaultStoreId
        }));

        parsed.follow_ups = parsed.follow_ups.map(followUp => ({
          ...followUp,
          store_id: followUp.store_id || defaultStoreId
        }));

        return parsed;
      }
    } catch (err) {
      console.error(
        '[DB] Failed to load database:',
        err.message
      );
    }

    const freshData = JSON.parse(
      JSON.stringify(initialData)
    );

    this.saveData(freshData);

    return freshData;
  }

  // ==========================================================
  // SAVE DATABASE
  // ==========================================================

  saveData(dataToSave = this.data) {
    try {
      fs.writeFileSync(
        DB_PATH,
        JSON.stringify(dataToSave, null, 2),
        'utf8'
      );
    } catch (err) {
      console.error(
        '[DB] Failed to save database:',
        err.message
      );
    }
  }

  // ==========================================================
  // STORES
  // ==========================================================

  getStores() {
    return this.data.stores;
  }

  getStore(storeId) {
    if (!storeId) return null;

    return this.data.stores.find(
      store =>
        String(store.id) === String(storeId) ||
        String(store.type || '') === String(storeId)
    ) || null;
  }

  getStoreByInstagramUserId(instagramUserId) {
    if (!instagramUserId) return null;

    return this.data.stores.find(
      store => String(store.instagram_user_id || '') === String(instagramUserId)
    ) || null;
  }

  getStoreByInstagramUsername(username) {
    if (!username) return null;
    const normalized = String(username).replace(/^@/, '').toLowerCase();

    return this.data.stores.find(store =>
      String(store.instagram_username || '').replace(/^@/, '').toLowerCase() === normalized
    ) || null;
  }

  createStore(storeData = {}) {
    const id =
      storeData.id ||
      `store_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const store = {
      id,
      name: storeData.name || storeData.business_name || 'New Business',
      business_name: storeData.business_name || storeData.name || 'New Business',
      type: storeData.type || 'custom',
      instagram_user_id: storeData.instagram_user_id || null,
      instagram_username: storeData.instagram_username || null,
      instagram_access_token: storeData.instagram_access_token || null,
      status: storeData.status || 'active',
      ai_enabled: storeData.ai_enabled !== false,
      comment_reply_enabled: storeData.comment_reply_enabled !== false,
      dm_reply_enabled: storeData.dm_reply_enabled !== false,
      currency: storeData.currency || process.env.CURRENCY_SYMBOL || '₹',
      active_promo_code: storeData.active_promo_code || '',
      promo_discount_percent: storeData.promo_discount_percent || 0,
      urgency_timer_minutes: storeData.urgency_timer_minutes || 20,
      free_shipping_threshold: storeData.free_shipping_threshold || 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...storeData,
      id
    };

    this.data.stores.push(store);
    this.saveData();
    return store;
  }

  updateStore(storeId, updates = {}) {
    const index = this.data.stores.findIndex(
      store => String(store.id) === String(storeId)
    );

    if (index === -1) return null;

    this.data.stores[index] = {
      ...this.data.stores[index],
      ...updates,
      updated_at: new Date().toISOString()
    };

    this.saveData();
    return this.data.stores[index];
  }

  // ==========================================================
  // PRODUCTS
  // ==========================================================

  getProducts(storeId) {
    if (!storeId) return this.data.products;
    return this.data.products.filter(product =>
      String(product.store_id || product.store_type || '') === String(storeId)
    );
  }

  getProductById(id) {
    return this.data.products.find(
      product =>
        String(product.id) === String(id)
    );
  }

  getProductByInstagramId(instagramMediaId) {
    return this.data.products.find(
      product =>
        String(product.instagram_media_id) ===
        String(instagramMediaId)
    );
  }

  searchProducts(query, storeType = null) {
    if (!query) {
      return this.getProducts(storeType);
    }

    const search = String(query)
      .toLowerCase()
      .trim();

    const products =
      this.getProducts(storeType);

    return products.filter(product => {
      const searchableText = [
        product.name,
        product.category,
        product.instagram_caption,
        ...(product.colors || []),
        ...(product.sizes || []),
        ...(product.ad_triggers || []),
        ...(product.tags || [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchableText.includes(search);
    });
  }

  searchProductsSmart(
    query,
    storeType = null
  ) {
    const products =
      this.getProducts(storeType);

    if (!query) {
      return products;
    }

    const words = String(query)
      .toLowerCase()
      .split(/\s+/)
      .filter(
        word => word.length >= 2
      );

    const results = products
      .map(product => {
        const text = [
          product.name,
          product.category,
          product.instagram_caption,
          ...(product.colors || []),
          ...(product.sizes || []),
          ...(product.tags || []),
          ...(product.ad_triggers || [])
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        let score = 0;

        for (const word of words) {
          if (text.includes(word)) {
            score++;
          }

          if (
            String(product.name || '')
              .toLowerCase()
              .includes(word)
          ) {
            score += 2;
          }
        }

        return {
          product,
          score
        };
      })
      .filter(
        item => item.score > 0
      )
      .sort(
        (a, b) =>
          b.score - a.score
      );

    return results.map(
      item => item.product
    );
  }

  findProductByAdTrigger(
    storeType,
    adTrigger
  ) {
    const products =
      this.getProducts(storeType);

    if (!products.length) {
      return null;
    }

    if (!adTrigger) {
      return products[0];
    }

    const search =
      String(adTrigger).toLowerCase();

    const match = products.find(
      product => {
        const triggers = [
          ...(product.ad_triggers || []),
          ...(product.tags || [])
        ];

        return triggers.some(
          trigger =>
            String(trigger)
              .toLowerCase()
              .includes(search)
        );
      }
    );

    return match || products[0];
  }

  // ==========================================================
  // ADD PRODUCT
  // ==========================================================

  addProduct(productData) {
    const prefix =
      productData.store_type === 'electronics'
        ? 'elec'
        : 'cloth';

    const id =
      productData.id ||
      `${prefix}_${Date.now()}`;

    const newProduct = {
      id,
      source: productData.source || 'manual',
      store_id: productData.store_id || productData.store_type || 'clothing',
      ...productData
    };

    this.data.products.push(
      newProduct
    );

    this.saveData();

    return newProduct;
  }

  // ==========================================================
  // UPDATE PRODUCT
  // ==========================================================

  updateProduct(id, updates) {
    const index =
      this.data.products.findIndex(
        product =>
          String(product.id) ===
          String(id)
      );

    if (index === -1) {
      return null;
    }

    this.data.products[index] = {
      ...this.data.products[index],
      ...updates,
      updated_at:
        new Date().toISOString()
    };

    this.saveData();

    return this.data.products[index];
  }

  // ==========================================================
  // DELETE PRODUCT
  // ==========================================================

  deleteProduct(id) {
    const originalLength =
      this.data.products.length;

    this.data.products =
      this.data.products.filter(
        product =>
          String(product.id) !==
          String(id)
      );

    if (
      this.data.products.length !==
      originalLength
    ) {
      this.saveData();
      return true;
    }

    return false;
  }

  // ==========================================================
  // SYNC INSTAGRAM PRODUCTS
  // ==========================================================

  syncInstagramProducts(
    instagramMedia,
    storeType = 'clothing'
  ) {
    let added = 0;
    let updated = 0;

    if (!Array.isArray(instagramMedia)) {
      return {
        added: 0,
        updated: 0,
        total: 0
      };
    }

    for (const media of instagramMedia) {
      if (!media || !media.id) {
        continue;
      }

      const productId =
        `ig_${media.id}`;

      const existingIndex =
        this.data.products.findIndex(
          product =>
            String(product.instagram_media_id || '') === String(media.id) &&
            String(product.store_id || product.store_type || '') === String(storeType)
        );

      const caption =
        media.caption || '';

      const productName =
        extractProductName(
          caption,
          media.id
        );

      const price =
        extractPrice(caption);

      const sizes =
        extractSizes(caption);

      const colors =
        extractColors(caption);

      const stock =
        extractStock(caption);

      const category =
        detectCategory(
          caption,
          storeType
        );

      const hashtags =
        extractHashtags(caption);

      const product = {
        id: productId,

        source: 'instagram',

        store_type: storeType,
        store_id: storeType,

        name: productName,

        category,

        price,

        original_price: price,

        stock,

        sizes,

        colors,

        tags: hashtags,

        ad_triggers: hashtags,

        image_url:
          media.media_type === 'VIDEO'
            ? (
                media.thumbnail_url ||
                media.media_url ||
                ''
              )
            : (
                media.media_url ||
                ''
              ),

        video_url:
          media.media_type === 'VIDEO'
            ? media.media_url || null
            : null,

        media_type:
          media.media_type || 'IMAGE',

        instagram_media_id:
          media.id,

        instagram_account_id:
          process.env.INSTAGRAM_ACCOUNT_ID ||
          '',

        instagram_url:
          media.permalink || '',

        instagram_permalink:
          media.permalink || '',

        instagram_caption:
          caption,

        instagram_timestamp:
          media.timestamp || null,

        checkout_url:
          extractCheckoutUrl(caption),

        synced_at:
          new Date().toISOString()
      };

      if (existingIndex !== -1) {
        const oldProduct =
          this.data.products[
            existingIndex
          ];

        this.data.products[
          existingIndex
        ] = {
          ...oldProduct,
          ...product,

          checkout_url:
            product.checkout_url ||
            oldProduct.checkout_url ||
            '',

          stock:
            stock !== null
              ? stock
              : oldProduct.stock,

          price:
            price !== null
              ? price
              : oldProduct.price
        };

        updated++;
      } else {
        this.data.products.push(
          product
        );

        added++;
      }
    }

    this.saveData();

    return {
      added,
      updated,
      total:
        instagramMedia.length
    };
  }

  // ==========================================================
  // REMOVE OLD INSTAGRAM PRODUCTS
  // ==========================================================

  removeOldInstagramProducts(
    validInstagramIds,
    storeId = null
  ) {
    const validIds =
      new Set(
        (validInstagramIds || []).map(
          id => String(id)
        )
      );

    const before =
      this.data.products.length;

    this.data.products =
      this.data.products.filter(
        product => {
          // Manual products remain.
          if (product.source !== 'instagram') {
            return true;
          }

          if (storeId && String(product.store_id || product.store_type || '') !== String(storeId)) {
            return true;
          }

          return validIds.has(
            String(product.instagram_media_id)
          );
        }
      );

    const removed =
      before -
      this.data.products.length;

    if (removed > 0) {
      this.saveData();
    }

    return removed;
  }

  // ==========================================================
  // CONVERSATIONS
  // ==========================================================

  getConversation(sessionId, storeId = null) {
    return this.data.conversations.find(conversation => {
      if (conversation.session_id !== sessionId) return false;
      if (!storeId) return true;
      return String(conversation.store_id || conversation.store_type || '') === String(storeId);
    });
  }

  getConversationByInstagramUserId(instagramUserId, storeId = null) {
    if (!instagramUserId) return null;

    return this.data.conversations.find(conversation => {
      if (String(conversation.instagram_user_id || '') !== String(instagramUserId)) return false;
      if (!storeId) return true;
      return String(conversation.store_id || conversation.store_type || '') === String(storeId);
    }) || null;
  }

  getConversationByCustomerHandle(customerHandle, storeId = null) {
    if (!customerHandle) return null;

    return this.data.conversations.find(conversation => {
      if (String(conversation.customer_handle || '').toLowerCase() !== String(customerHandle).toLowerCase()) return false;
      if (!storeId) return true;
      return String(conversation.store_id || conversation.store_type || '') === String(storeId);
    }) || null;
  }

  getOrCreateConversation(
    sessionId,
    defaultStore = 'clothing',
    platform = 'simulator',
    metadata = {},
    storeId = null
  ) {
    const tenantId = storeId || defaultStore;
    let conversation = this.getConversation(sessionId, tenantId);

    if (conversation) {
      let changed = false;

      if (metadata.instagram_user_id && !conversation.instagram_user_id) {
        conversation.instagram_user_id = metadata.instagram_user_id; changed = true;
      }
      if (metadata.customer_name && (!conversation.customer_name || conversation.customer_name === 'Shopper')) {
        conversation.customer_name = metadata.customer_name; changed = true;
      }
      if (metadata.customer_handle && (!conversation.customer_handle || conversation.customer_handle === '@shopper')) {
        conversation.customer_handle = metadata.customer_handle; changed = true;
      }
      if (metadata.instagram_media_id && !conversation.instagram_media_id) {
        conversation.instagram_media_id = metadata.instagram_media_id; changed = true;
      }
      if (metadata.instagram_comment_id) {
        conversation.instagram_comment_id = metadata.instagram_comment_id; changed = true;
      }

      if (changed) {
        conversation.last_message_at = new Date().toISOString();
        this.saveData();
      }

      return conversation;
    }

    if (metadata.instagram_user_id) {
      const existing = this.getConversationByInstagramUserId(
        metadata.instagram_user_id,
        tenantId
      );

      if (existing) {
        if (metadata.customer_name && existing.customer_name === 'Shopper') existing.customer_name = metadata.customer_name;
        if (metadata.customer_handle) existing.customer_handle = metadata.customer_handle;
        if (metadata.instagram_comment_id) existing.instagram_comment_id = metadata.instagram_comment_id;
        if (metadata.instagram_media_id) existing.instagram_media_id = metadata.instagram_media_id;
        existing.last_message_at = new Date().toISOString();
        this.saveData();
        return existing;
      }
    }

    conversation = {
      session_id: sessionId,
      store_id: tenantId,
      platform,
      customer_name: metadata.customer_name || 'Shopper',
      customer_handle: metadata.customer_handle || '@shopper',
      instagram_user_id: metadata.instagram_user_id || null,
      instagram_comment_id: metadata.instagram_comment_id || null,
      instagram_media_id: metadata.instagram_media_id || null,
      phone: metadata.phone || null,
      email: metadata.email || null,
      store_type: defaultStore,
      stage: 'HOOK',
      intent_score: 'WARM',
      attributes: {},
      ad_campaign_id: metadata.ad_campaign_id || null,
      interested_product_id: metadata.interested_product_id || null,
      claimed_coupon: null,
      created_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
      is_active: true,
      follow_up_count: 0
    };

    this.data.conversations.push(conversation);
    this.saveData();
    return conversation;
  }

  updateConversation(sessionId, updates) {
    const index = this.data.conversations.findIndex(
      conversation => conversation.session_id === sessionId
    );
    if (index === -1) return null;

    this.data.conversations[index] = {
      ...this.data.conversations[index],
      ...updates,
      last_message_at: new Date().toISOString()
    };

    this.saveData();
    return this.data.conversations[index];
  }

  getRecentConversations(limit = 20, storeId = null) {
    return [...this.data.conversations]
      .filter(conversation => {
        if (!storeId) return true;
        return String(conversation.store_id || conversation.store_type || '') === String(storeId);
      })
      .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at))
      .slice(0, limit);
  }

  // ==========================================================
  // MESSAGES
  // ==========================================================

  getMessages(sessionId, storeId = null) {
    return this.data.messages.filter(message => {
      if (message.conversation_id !== sessionId) return false;
      if (!storeId) return true;
      return String(message.store_id || '') === String(storeId);
    });
  }

  getMessageByExternalId(
    externalId
  ) {
    if (!externalId) {
      return null;
    }

    return this.data.messages.find(
      message =>
        String(
          message.external_id || ''
        ) === String(externalId)
    );
  }

  addMessage(
    sessionId,
    sender,
    text,
    extras = {}
  ) {
    const message = {
      id:
        `msg_${Date.now()}_${Math.random()
          .toString(36)
          .substring(2, 7)}`,

      conversation_id:
        sessionId,

      store_id:
        extras.store_id ||
        this.getConversation(sessionId)?.store_id ||
        this.getConversation(sessionId)?.store_type ||
        null,

      sender,

      text,

      external_id:
        extras.external_id ||
        null,

      platform:
        extras.platform ||
        null,

      quick_replies:
        extras.quick_replies ||
        [],

      product_cards:
        extras.product_cards ||
        [],

      voice_snippets:
        extras.voice_snippets ||
        [],

      gamified_discount:
        extras.gamified_discount ||
        null,

      order_receipt:
        extras.order_receipt ||
        null,

      action_buttons:
        extras.action_buttons ||
        [],

      timestamp:
        new Date().toISOString()
    };

    this.data.messages.push(
      message
    );

    this.updateConversation(
      sessionId,
      {
        last_message_at:
          message.timestamp
      }
    );

    this.saveData();

    return message;
  }

  // ==========================================================
  // LEADS
  // ==========================================================

  getLeads(storeId = null) {
    return [
      ...this.data.leads
    ].filter(lead => {
      if (!storeId) return true;
      return String(lead.store_id || lead.store_type || '') === String(storeId);
    }).sort(
      (a, b) =>
        new Date(b.created_at) -
        new Date(a.created_at)
    );
  }

  getLeadBySession(sessionId, storeId = null) {
    return this.data.leads.find(lead => {
      if (lead.conversation_id !== sessionId) return false;
      if (!storeId) return true;
      return String(lead.store_id || lead.store_type || '') === String(storeId);
    });
  }

  getLeadByInstagramUserId(
    instagramUserId,
    storeId = null
  ) {
    if (!instagramUserId) {
      return null;
    }

    return this.data.leads.find(lead => {
      if (String(lead.instagram_user_id || '') !== String(instagramUserId)) return false;
      if (!storeId) return true;
      return String(lead.store_id || lead.store_type || '') === String(storeId);
    });
  }

  saveOrUpdateLead(
    sessionId,
    leadData
  ) {
    let existingIndex =
      this.data.leads.findIndex(
        lead =>
          lead.conversation_id ===
          sessionId
      );

    const conversation =
      this.getConversation(sessionId);

    /*
     * If the session is an Instagram comment
     * but an existing Instagram lead exists,
     * update the existing lead instead of
     * creating a second lead.
     */
    if (
      existingIndex === -1 &&
      leadData.instagram_user_id
    ) {
      existingIndex =
        this.data.leads.findIndex(
          lead =>
            String(
              lead.instagram_user_id ||
                ''
            ) ===
            String(
              leadData.instagram_user_id
            )
        );
    }

    const previous =
      existingIndex !== -1
        ? this.data.leads[
            existingIndex
          ]
        : {};

    const lead = {
      id:
        existingIndex !== -1
          ? previous.id
          : `lead_${Date.now()}`,

      conversation_id:
        conversation?.session_id ||
        sessionId,

      store_id:
        leadData.store_id ||
        conversation?.store_id ||
        leadData.store_type ||
        conversation?.store_type ||
        'clothing',

      instagram_user_id:
        leadData.instagram_user_id ??
        previous.instagram_user_id ??
        conversation?.instagram_user_id ??
        null,

      customer_name:
        leadData.customer_name ||
        conversation?.customer_name ||
        'Shopper',

      customer_handle:
        leadData.customer_handle ||
        conversation?.customer_handle ||
        '@shopper',

      store_type:
        leadData.store_type ||
        conversation?.store_type ||
        'clothing',

      phone:
        leadData.phone ??
        previous.phone ??
        conversation?.phone ??
        null,

      email:
        leadData.email ??
        previous.email ??
        null,

      shipping_city:
        leadData.shipping_city ??
        previous.shipping_city ??
        null,

      interested_product:
        leadData.interested_product ??
        previous.interested_product ??
        null,

      interested_product_id:
        leadData.interested_product_id ??
        previous.interested_product_id ??
        null,

      cart_value:
        leadData.cart_value ??
        previous.cart_value ??
        0,

      intent_score:
        leadData.intent_score ||
        conversation?.intent_score ||
        'WARM',

      status:
        leadData.status ||
        previous.status ||
        'OPEN',

      created_at:
        existingIndex !== -1
          ? previous.created_at
          : new Date().toISOString(),

      updated_at:
        new Date().toISOString()
    };

    if (existingIndex !== -1) {
      this.data.leads[
        existingIndex
      ] = lead;
    } else {
      this.data.leads.push(
        lead
      );
    }

    this.saveData();

    return lead;
  }

  // ==========================================================
  // CHECKOUT
  // ==========================================================

  completeCheckout(
    sessionId,
    orderDetails = {}
  ) {
    const conversation =
      this.getConversation(sessionId);

    const lead =
      this.saveOrUpdateLead(
        sessionId,
        {
          status: 'PURCHASED',

          intent_score: 'HOT',

          instagram_user_id:
            conversation?.instagram_user_id ||
            null,

          cart_value:
            Number(
              orderDetails.total_price
            ) || 0,

          interested_product:
            orderDetails.product_name ||
            null,

          interested_product_id:
            orderDetails.product_id ||
            null
        }
      );

    this.updateConversation(
      sessionId,
      {
        stage: 'CONVERTED',
        is_active: false
      }
    );

    // Cancel pending follow-ups.
    this.data.follow_ups =
      this.data.follow_ups.map(
        followUp => {
          if (
            followUp.conversation_id ===
            sessionId
          ) {
            return {
              ...followUp,
              executed: true,
              cancelled: true,
              cancelled_reason:
                'PURCHASED',
              cancelled_at:
                new Date().toISOString()
            };
          }

          return followUp;
        }
      );

    this.saveData();

    return lead;
  }

  // ==========================================================
  // FOLLOW UPS
  // ==========================================================

  scheduleFollowUp(
    sessionId,
    stage,
    delayMinutes = 15,
    customPrompt = ''
  ) {
    const scheduledTime =
      new Date(
        Date.now() +
          Number(delayMinutes) *
            60 *
            1000
      ).toISOString();

    this.data.follow_ups =
      this.data.follow_ups.filter(
        followUp =>
          !(
            followUp.conversation_id ===
              sessionId &&
            followUp.stage === stage &&
            !followUp.executed
          )
      );

    const followUp = {
      id:
        `fu_${Date.now()}_${Math.random()
          .toString(36)
          .substring(2, 6)}`,

      conversation_id:
        sessionId,

      store_id:
        this.getConversation(sessionId)?.store_id ||
        this.getConversation(sessionId)?.store_type ||
        null,

      stage,

      scheduled_time:
        scheduledTime,

      custom_prompt:
        customPrompt,

      executed: false,

      created_at:
        new Date().toISOString()
    };

    this.data.follow_ups.push(
      followUp
    );

    this.saveData();

    return followUp;
  }

  getPendingFollowUps() {
    const now =
      new Date().toISOString();

    return this.data.follow_ups.filter(
      followUp =>
        !followUp.executed &&
        !followUp.cancelled &&
        followUp.scheduled_time <= now
    );
  }

  markFollowUpExecuted(
    id,
    messageSent,
    extra = {}
  ) {
    const index =
      this.data.follow_ups.findIndex(
        followUp =>
          followUp.id === id
      );

    if (index === -1) {
      return null;
    }

    this.data.follow_ups[index] = {
      ...this.data.follow_ups[index],

      executed: true,

      executed_at:
        new Date().toISOString(),

      message_sent:
        Boolean(messageSent),

      ...extra
    };

    this.saveData();

    return this.data.follow_ups[index];
  }

  // ==========================================================
  // WEBHOOK IDEMPOTENCY / BOT REPLIES
  // ==========================================================

  hasProcessedWebhookEvent(key) {
    return this.data.processed_webhook_events.some(item => item.key === key);
  }

  markWebhookEventProcessed(key, storeId = null) {
    if (this.hasProcessedWebhookEvent(key)) return false;

    this.data.processed_webhook_events.push({
      key,
      store_id: storeId,
      processed_at: new Date().toISOString()
    });

    if (this.data.processed_webhook_events.length > 10000) {
      this.data.processed_webhook_events = this.data.processed_webhook_events.slice(-5000);
    }

    this.saveData();
    return true;
  }

  hasOurInstagramReplyId(commentId) {
    return this.data.our_instagram_reply_ids.some(
      item => String(item.comment_id) === String(commentId)
    );
  }

  saveOurInstagramReplyId(commentId, storeId = null) {
    if (!commentId || this.hasOurInstagramReplyId(commentId)) return;

    this.data.our_instagram_reply_ids.push({
      comment_id: String(commentId),
      store_id: storeId,
      created_at: new Date().toISOString()
    });

    if (this.data.our_instagram_reply_ids.length > 10000) {
      this.data.our_instagram_reply_ids = this.data.our_instagram_reply_ids.slice(-5000);
    }

    this.saveData();
  }

  // ==========================================================
  // ANALYTICS
  // ==========================================================

  getAnalytics() {
    const totalConversations =
      this.data.conversations.length;

    const totalMessages =
      this.data.messages.length;

    const totalLeads =
      this.data.leads.length;

    // Only an actual PURCHASED lead is a conversion.
    const convertedLeads =
      this.data.leads.filter(
        lead =>
          lead.status === 'PURCHASED'
      ).length;

    const checkoutClickedLeads =
      this.data.leads.filter(
        lead =>
          lead.status ===
          'CHECKOUT_CLICKED'
      ).length;

    const hotLeads =
      this.data.leads.filter(
        lead =>
          lead.intent_score === 'HOT'
      ).length;

    let totalRevenue = 0;

    this.data.leads.forEach(
      lead => {
        if (
          lead.status ===
          'PURCHASED'
        ) {
          totalRevenue +=
            Number(
              lead.cart_value
            ) || 0;
        }
      }
    );

    const conversionRate =
      totalLeads > 0
        ? (
            convertedLeads /
            totalLeads *
            100
          ).toFixed(1) + '%'
        : '0%';

    const clothingConversations =
      this.data.conversations.filter(
        conversation =>
          conversation.store_type ===
          'clothing'
      ).length;

    const electronicsConversations =
      this.data.conversations.filter(
        conversation =>
          conversation.store_type ===
          'electronics'
      ).length;

    const currency =
      process.env.CURRENCY_SYMBOL ||
      '₹';

    return {
      totalConversations,

      totalMessages,

      totalLeads,

      convertedLeads,

      checkoutClickedLeads,

      conversionRate,

      hotLeads,

      totalRevenue:
        currency +
        totalRevenue.toFixed(2),

      totalProducts:
        this.data.products.length,

      instagramProducts:
        this.data.products.filter(
          product =>
            product.source ===
            'instagram'
        ).length,

      breakdown: {
        clothing:
          clothingConversations,

        electronics:
          electronicsConversations
      }
    };
  }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function extractProductName(
  caption,
  mediaId
) {
  if (!caption) {
    return `Instagram Product ${mediaId}`;
  }

  const lines =
    caption
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

  if (!lines.length) {
    return `Instagram Product ${mediaId}`;
  }

  let name = lines[0];

  // Don't use a price-only line as product name.
  if (
    /^(₹|rs\.?|inr|\$)\s*[\d,]+/i.test(
      name
    )
  ) {
    name =
      lines[1] ||
      `Instagram Product ${mediaId}`;
  }

  return name
    .replace(/^#+/, '')
    .substring(0, 120)
    .trim();
}

function extractPrice(caption) {
  if (!caption) {
    return null;
  }

  const patterns = [
    /₹\s*([0-9,]+(?:\.[0-9]+)?)/i,

    /rs\.?\s*([0-9,]+(?:\.[0-9]+)?)/i,

    /inr\s*([0-9,]+(?:\.[0-9]+)?)/i,

    /\$\s*([0-9,]+(?:\.[0-9]+)?)/i,

    /price\s*[:=-]?\s*₹?\s*([0-9,]+(?:\.[0-9]+)?)/i,

    /price\s*[:=-]?\s*rs\.?\s*([0-9,]+(?:\.[0-9]+)?)/i,

    /price\s*[:=-]?\s*([0-9,]+(?:\.[0-9]+)?)/i
  ];

  for (const pattern of patterns) {
    const match =
      caption.match(pattern);

    if (match) {
      return Number(
        match[1].replace(
          /,/g,
          ''
        )
      );
    }
  }

  return null;
}

function extractStock(caption) {
  if (!caption) {
    return null;
  }

  const match =
    caption.match(
      /\b(?:stock|available|qty|quantity)\s*[:=-]?\s*(\d+)/i
    );

  if (!match) {
    return null;
  }

  return Number(match[1]);
}

function extractSizes(caption) {
  if (!caption) {
    return [];
  }

  const sizes = [];

  const possibleSizes = [
    'XS',
    'S',
    'M',
    'L',
    'XL',
    'XXL',
    'XXXL'
  ];

  for (
    const size of possibleSizes
  ) {
    const regex =
      new RegExp(
        `(?:^|[\\s,|/:-])${size}(?=$|[\\s,|/:.-])`,
        'i'
      );

    if (
      regex.test(caption)
    ) {
      sizes.push(size);
    }
  }

  return [
    ...new Set(sizes)
  ];
}

function extractColors(caption) {
  if (!caption) {
    return [];
  }

  const colors = [
    'black',
    'white',
    'blue',
    'red',
    'green',
    'yellow',
    'orange',
    'brown',
    'maroon',
    'grey',
    'gray',
    'pink',
    'purple',
    'beige',
    'navy',
    'cream',
    'olive',
    'khaki'
  ];

  const text =
    caption.toLowerCase();

  return colors.filter(
    color =>
      text.includes(color)
  );
}

function extractHashtags(caption) {
  if (!caption) {
    return [];
  }

  const hashtags =
    caption.match(
      /#[a-zA-Z0-9_]+/g
    ) || [];

  return hashtags.map(
    hashtag =>
      hashtag
        .substring(1)
        .toLowerCase()
  );
}

function extractCheckoutUrl(caption) {
  if (!caption) {
    return '';
  }

  const match =
    caption.match(
      /https?:\/\/[^\s]+/i
    );

  if (!match) {
    return '';
  }

  return match[0]
    .replace(/[),.!?]+$/, '');
}

function detectCategory(
  caption,
  storeType
) {
  const text =
    String(caption || '')
      .toLowerCase();

  if (
    storeType ===
    'electronics'
  ) {
    if (
      text.includes('earbud') ||
      text.includes('headphone') ||
      text.includes('speaker')
    ) {
      return 'Audio';
    }

    if (
      text.includes('watch') ||
      text.includes('smartwatch')
    ) {
      return 'Wearables';
    }

    if (
      text.includes('charger') ||
      text.includes('cable') ||
      text.includes('power bank')
    ) {
      return 'Charging & Accessories';
    }

    if (
      text.includes('phone') ||
      text.includes('mobile')
    ) {
      return 'Mobile Accessories';
    }

    return 'Electronics';
  }

  if (
    text.includes('shirt') ||
    text.includes('tshirt') ||
    text.includes('t-shirt')
  ) {
    return 'Shirts & T-Shirts';
  }

  if (
    text.includes('hoodie') ||
    text.includes('sweatshirt')
  ) {
    return 'Hoodies & Sweatshirts';
  }

  if (
    text.includes('jeans') ||
    text.includes('pant') ||
    text.includes('cargo')
  ) {
    return 'Pants & Bottoms';
  }

  if (
    text.includes('jacket') ||
    text.includes('coat')
  ) {
    return 'Jackets & Outerwear';
  }

  if (
    text.includes('dress') ||
    text.includes('saree') ||
    text.includes('kurti')
  ) {
    return 'Dresses & Ethnic Wear';
  }

  return 'Fashion';
}

// ============================================================
// EXPORT SINGLE DATABASE INSTANCE
// ============================================================

module.exports = new Database();





