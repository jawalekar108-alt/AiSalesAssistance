require('dotenv').config();
const V = process.env.META_GRAPH_VERSION || 'v23.0';
const token = process.env.WHATSAPP_ACCESS_TOKEN;
const verify = process.env.META_VERIFY_TOKEN || 'ai_sales_automation_2026';
const WABA = '1409193438037381';
const url = process.argv[2]; // e.g. https://giveaway-catnip-humming.ngrok-free.dev/webhook

if (!url || !url.startsWith('https://') || !url.endsWith('/webhook')) {
  console.error('Usage: node src/scripts/wa_set_callback.js https://YOUR-NGROK-URL/webhook');
  process.exit(1);
}

(async () => {
  const post = await fetch(`https://graph.facebook.com/${V}/${WABA}/subscribed_apps`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ override_callback_uri: url, verify_token: verify })
  });
  console.log('Set callback:', post.status, JSON.stringify(await post.json()));

  const get = await fetch(`https://graph.facebook.com/${V}/${WABA}/subscribed_apps`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('Now:', JSON.stringify(await get.json(), null, 2));
})();