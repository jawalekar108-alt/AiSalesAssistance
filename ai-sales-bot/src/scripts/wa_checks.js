require('dotenv').config();
const V = process.env.META_GRAPH_VERSION || 'v23.0';

async function g(method, path, token, body) {
  const r = await fetch(`https://graph.facebook.com/${V}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  console.log(`\n${method} ${path.split('?')[0]} -> ${r.status}\n`, JSON.stringify(j, null, 2));
  return j;
}

(async () => {
  const [waba, token] = [process.argv[2], process.argv[3] || process.env.WHATSAPP_ACCESS_TOKEN];
  if (!waba) throw new Error('Usage: node scripts/wa_check.js <WABA_ID> [TOKEN]');

  // 1. is my app subscribed to this WABA?
  await g('GET', `${waba}/subscribed_apps`, token);
  // 2. numbers under this WABA (status, name, quality)
  await g('GET', `${waba}/phone_numbers?fields=id,display_phone_number,verified_name,status,code_verification_status`, token);
  // 3. does the token still work, what does it expire?
  const appToken = `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`;
  await g('GET', `debug_token?input_token=${token}`, appToken);

  // optional: subscribe (safe to repeat)
  if (process.argv.includes('--subscribe')) await g('POST', `${waba}/subscribed_apps`, token);
})();