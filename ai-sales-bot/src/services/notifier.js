//13/10
const axios = require('axios');
const wa = require('./whatsapp');
const orders = require('./orders');
const { normalizeNumber } = require('./whatsappLink');

/*
 * Tells the business owner (tenant) about new orders and payment screenshots.
 *
 * Store settings (set per business):
 *   owner_whatsapp   owner's personal WhatsApp number, e.g. 919876543210
 *                    (must NOT be the business number the bot uses)
 *   owner_email      owner's email address (optional)
 *
 * .env (optional):
 *   WHATSAPP_ORDER_TEMPLATE=new_order_alert   approved template with 4 variables
 *   WHATSAPP_ORDER_TEMPLATE_LANG=en
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM   for email
 *
 * Why a template? WhatsApp only allows a free text message to a person who
 * messaged the business number within the last 24 hours. A new-order alert
 * can arrive any time, so an approved template is the reliable way.
 * Email works at any time.
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';

function money(store, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return `${store.currency || process.env.CURRENCY_SYMBOL || '₹'}${n.toLocaleString('en-IN')}`;
}

function businessName(store) {
  return store.business_name || store.name || 'Your store';
}

function orderText(store, order) {
  const lines = [
    `🛒 *New order ${order.id}*`,
    `🏪 ${businessName(store)}`,
    '',
    `📦 ${order.product_name}`,
    `💰 Total: ${money(store, order.total) || 'to be confirmed'}`,
    `💳 Payment: ${order.payment === 'UPI' ? 'UPI (waiting for payment)' : 'Cash on delivery'}`,
    '',
    `👤 ${order.customer_name}`,
    `📞 ${order.customer_phone}`,
    `📍 ${order.address}`
  ];

  return lines.join('\n');
}

/* ---------- WhatsApp ---------- */

async function sendTemplate(store, to, order) {
  const name = process.env.WHATSAPP_ORDER_TEMPLATE;
  if (!name) return false;

  const { token, phoneId } = wa.resolve(store);

  // Template variables cannot contain new lines
  const clean = s => String(s || '').replace(/[\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 200) || '-';

  await axios.post(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name,
        language: { code: process.env.WHATSAPP_ORDER_TEMPLATE_LANG || 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: clean(order.id) },
              { type: 'text', text: clean(`${order.customer_name} ${order.customer_phone}`) },
              { type: 'text', text: clean(order.product_name) },
              { type: 'text', text: clean(`${money(store, order.total)} ${order.payment === 'UPI' ? 'UPI' : 'COD'}`) }
            ]
          }
        ]
      }
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 15000 }
  );

  return true;
}

async function viaWhatsApp(store, text, order) {
  const to = normalizeNumber(store.owner_whatsapp);
  if (!to) return false;

  // 1) plain text (works when the owner messaged the bot in the last 24 hours)
  try {
    await wa.sendText(store, to, text);
    return true;
  } catch (error) {
    console.warn('[NOTIFY] WhatsApp text failed:', error.graph?.code, error.message);
  }

  // 2) approved template (works any time)
  if (order && process.env.WHATSAPP_ORDER_TEMPLATE) {
    try {
      return await sendTemplate(store, to, order);
    } catch (error) {
      console.error('[NOTIFY] WhatsApp template failed:', error.response?.data?.error?.message || error.message);
    }
  }

  return false;
}

/* ---------- Email ---------- */

let transporter = null;

async function viaEmail(store, subject, text) {
  const to = String(store.owner_email || '').trim();
  if (!to || !process.env.SMTP_HOST) return false;

  try {
    if (!transporter) {
      const nodemailer = require('nodemailer');

      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
    }

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text: text.replace(/\*/g, '')
    });

    return true;
  } catch (error) {
    console.error('[NOTIFY] Email failed:', error.message);
    return false;
  }
}

/* ---------- Public API (never throws) ---------- */

async function deliver(store, subject, text, order) {
  const result = { whatsapp: false, email: false };

  try {
    console.log(`[NOTIFY] ${subject} (${store.id})\n${text}`);

    result.whatsapp = await viaWhatsApp(store, text, order);
    result.email = await viaEmail(store, subject, text);

    if (!result.whatsapp && !result.email) {
      console.warn(
        `[NOTIFY] Owner of "${store.id}" could not be reached. Set owner_whatsapp / owner_email (and a template or SMTP).`
      );
    }
  } catch (error) {
    console.error('[NOTIFY] Unexpected error:', error.message);
  }

  return result;
}

async function notifyNewOrder(store, order) {
  const result = await deliver(store, `New order ${order.id} - ${businessName(store)}`, orderText(store, order), order);

  orders.update(order.id, { owner_notified: result });

  return result;
}

async function notifyPaymentProof(store, order) {
  const text =
    `💳 *Payment screenshot received*\n` +
    `Order ${order.id} from ${order.customer_name} (${order.customer_phone}).\n` +
    `Please check your WhatsApp Business inbox and confirm the payment.`;

  return deliver(store, `Payment screenshot - order ${order.id}`, text, null);
}

module.exports = { notifyNewOrder, notifyPaymentProof };



