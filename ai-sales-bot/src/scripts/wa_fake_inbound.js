const to = process.argv[2];            // YOUR phone, digits only e.g. 919876543210
const text = process.argv[3] || 'hi';
if (!to) { console.error('Usage: node src/scripts/wa_fake_inbound.js 918087302410 "hi"'); process.exit(1); }

const payload = {
  object: 'whatsapp_business_account',
  entry: [{
    id: '1409193438037381',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '918432272557', phone_number_id: '1452254631296901' },
        contacts: [{ profile: { name: 'Test User' }, wa_id: to }],
        messages: [{ from: to, id: 'wamid.TEST' + Date.now(), timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }]
      }
    }]
  }]
};

fetch('http://localhost:3000/webhook', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
}).then(r => console.log('Server answered:', r.status));