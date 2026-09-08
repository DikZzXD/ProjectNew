import { readFileSync } from 'node:fs';
const har = JSON.parse(readFileSync('test/asithatop.har', 'utf8'));

let token = '';
for (const e of har.log.entries) {
  const u = new URL(e.request.url);
  if (u.host === 'back.asitha.top' && u.pathname === '/api/auth/user' && e.request.method === 'GET') {
    const auth = e.request.headers.find(h => h.name.toLowerCase() === 'authorization');
    if (auth) { token = auth.value.replace('Bearer ', ''); break; }
  }
}

// Let's look at the EXACT request that worked in the HAR for get-temp-token
// and replicate it precisely
for (const e of har.log.entries) {
  const u = new URL(e.request.url);
  if (u.host === 'back.asitha.top' && u.pathname === '/api/user/get-temp-token' && e.request.method === 'POST') {
    console.log('=== HAR: POST /api/user/get-temp-token ===');
    console.log('Status:', e.response.status);
    console.log('Request headers:');
    for (const h of e.request.headers) {
      if (/^(accept|content-type|origin|referer|cookie|x-|sec-)/i.test(h.name)) {
        let v = h.value;
        if (h.name.toLowerCase() === 'cookie') v = v.slice(0, 80) + '...';
        console.log(' ', h.name + ':', v);
      }
    }
    console.log('Body:', e.request.postData?.text?.slice(0, 200) || 'none');
    console.log();
  }
}

// Also check the react-to-post request in detail
for (const e of har.log.entries) {
  const u = new URL(e.request.url);
  if (u.host === 'back.asitha.top' && u.pathname === '/api/channel/react-to-post' && e.request.method === 'POST') {
    console.log('=== HAR: POST /api/channel/react-to-post ===');
    console.log('URL:', e.request.url);
    console.log('Status:', e.response.status);
    console.log('Request headers:');
    for (const h of e.request.headers) {
      if (/^(accept|content-type|origin|referer|cookie|x-|sec-|authorization)/i.test(h.name)) {
        let v = h.value;
        if (h.name.toLowerCase() === 'cookie') v = v.slice(0, 80) + '...';
        if (h.name.toLowerCase() === 'authorization') v = v.slice(0, 25) + '...';
        console.log(' ', h.name + ':', v);
      }
    }
    console.log('Body:', e.request.postData?.text?.slice(0, 200) || 'none');
    console.log('Response:', e.response.content?.text?.slice(0, 200) || 'none');
    console.log();
  }
}
