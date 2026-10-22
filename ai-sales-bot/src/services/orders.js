//orders 
/*
 * Orders placed through the WhatsApp chatbot.
 * Stored in data/orders.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ORDERS_PATH = path.join(__dirname, '../../data/orders.json');

function load() {
  try {
    if (fs.existsSync(ORDERS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(ORDERS_PATH, 'utf8'));
      return Array.isArray(parsed.orders) ? parsed.orders : [];
    }
  } catch (error) {
    console.error('[Orders] Could not read orders file:', error.message);
  }

  return [];
}

let orders = load();

function save() {
  fs.mkdirSync(path.dirname(ORDERS_PATH), { recursive: true });
  fs.writeFileSync(ORDERS_PATH, JSON.stringify({ orders }, null, 2), 'utf8');
}

function add(order) {
  const record = {
    id: 'ORD-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
    status: 'NEW',
    channel: 'whatsapp',
    created_at: new Date().toISOString(),
    ...order
  };

  orders.push(record);
  save();

  return record;
}

function list(storeId, limit = 100) {
  return orders
    .filter(o => String(o.store_id) === String(storeId))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
}

function get(id) {
  return orders.find(o => o.id === id) || null;
}

function update(id, changes) {
  const index = orders.findIndex(o => o.id === id);
  if (index === -1) return null;

  orders[index] = {
    ...orders[index],
    ...changes,
    updated_at: new Date().toISOString()
  };

  save();
  return orders[index];
}

module.exports = { add, list, get, update };


