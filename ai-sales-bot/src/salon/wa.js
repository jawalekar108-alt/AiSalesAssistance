// Minimal WhatsApp Cloud API sender. `conn` = row from salon_wa_connections.
const GRAPH = process.env.META_GRAPH_VERSION || process.env.GRAPH_VERSION || 'v23.0';
const clip = (s, n) => (String(s ?? '').length > n ? String(s).slice(0, n - 1) + '…' : String(s ?? ''));

async function call(conn, payload) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${conn.phone_number_id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${conn.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) console.error('[salon/wa] send failed', res.status, JSON.stringify(json));
  return { ok: res.ok, json };
}

const sendText = (conn, to, body) =>
  call(conn, { to, type: 'text', text: { body: clip(body, 4000), preview_url: false } });

// buttons: [{id,title}] max 3, title <= 20 chars
const sendButtons = (conn, to, body, buttons) =>
  call(conn, {
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: clip(body, 1000) },
      action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: clip(b.title, 20) } })) },
    },
  });

// rows: [{id,title,description?}] max 10, title <= 24, description <= 72
const sendList = (conn, to, body, buttonText, rows, sectionTitle = 'Options') =>
  call(conn, {
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: clip(body, 1000) },
      action: {
        button: clip(buttonText, 20),
        sections: [
          {
            title: clip(sectionTitle, 24),
            rows: rows.slice(0, 10).map((r) => ({
              id: r.id,
              title: clip(r.title, 24),
              ...(r.description ? { description: clip(r.description, 72) } : {}),
            })),
          },
        ],
      },
    },
  });

const sendTemplate = (conn, to, name, params = [], lang = 'en') =>
  call(conn, {
    to,
    type: 'template',
    template: {
      name,
      language: { code: lang },
      components: params.length
        ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) }]
        : [],
    },
  });

module.exports = { sendText, sendButtons, sendList, sendTemplate, clip };
