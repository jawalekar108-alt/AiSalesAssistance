const http = require('http');

async function testBackendEndpoints() {
  console.log('🧪 Testing Backend Diagnostic Endpoints...');

  const req1 = http.get('http://localhost:3000/webhook?hub.mode=subscribe&hub.verify_token=ai_sales_bot_secret_token_2026&hub.challenge=CHALLENGE_ACCEPTED', (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => console.log('✅ Webhook GET Handshake Response:', data));
  });

  const req2 = http.get('http://localhost:3000/api/simulator/webhook-logs', (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => console.log('✅ Webhook Logs Stream Count:', JSON.parse(data).logs.length));
  });
}

testBackendEndpoints();
