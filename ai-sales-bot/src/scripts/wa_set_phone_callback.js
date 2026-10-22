require('dotenv').config();
const V = process.env.META_GRAPH_VERSION || 'v23.0';
const token = process.env.WHATSAPP_ACCESS_TOKEN;
const verify = process.env.META_VERIFY_TOKEN || 'ai_sales_automation_2026';
const PHONE = '1452254631296901';
const url = process.argv[2];

if (!url || !url.startsWith('https://') || !url.endsWith('/webhook')) {
  console.error('Usage: node src/scripts/wa_set_phone_callback.js https://YOUR-NGROK-URL/webhook');
  process.exit(1);
}

(async () => {
  const r = await fetch(`https://graph.facebook.com/${V}/${PHONE}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ webhook_configuration: { override_callback_uri: url, verify_token: verify } })
  });
  console.log('Set phone callback:', r.status, JSON.stringify(await r.json()));

  const g = await fetch(`https://graph.facebook.com/${V}/${PHONE}?fields=webhook_configuration`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('Now:', JSON.stringify(await g.json(), null, 2));
})();