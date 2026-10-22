require('dotenv').config();
const V = process.env.META_GRAPH_VERSION || 'v23.0';
const token = process.env.WHATSAPP_ACCESS_TOKEN;
const WABA = '1409193438037381';
const PHONE = '1452254631296901';

async function g(path) {
  const r = await fetch(`https://graph.facebook.com/${V}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  console.log('\n' + path.split('?')[0], r.status, JSON.stringify(await r.json(), null, 2));
}

(async () => {
  await g(`${WABA}/subscribed_apps`);
  await g(`${PHONE}?fields=webhook_configuration,display_phone_number,account_mode,status`);
})();