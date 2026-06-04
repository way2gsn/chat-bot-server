const https = require('https');

const options = {
  hostname: 'phasalbazar.up.railway.app',
  port: 443,
  path: '/admin/stats',
  method: 'GET',
  headers: {
    'Authorization': 'Bearer phasal123'
  }
};

const req = https.request(options, (res) => {
  console.log('Status Code:', res.statusCode);
  console.log('Headers:', res.headers);

  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('Body:', data);
  });
});

req.on('error', (e) => {
  console.error('Error:', e);
});

req.end();
