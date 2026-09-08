import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const SECRET = 'AsithaApiSignatureKey2026!@#';
const API = 'https://back.asitha.top/api';
const HSOLVER_KEY = 'HS-5PRUQBEJXBFCKP';

const har = JSON.parse(readFileSync('test/asithatop.har', 'utf8'));
let bearerToken = '';
for (const e of har.log.entries) {
  const u = new URL(e.request.url);
  if (u.host === 'back.asitha.top' && u.pathname === '/api/auth/user' && e.request.method === 'GET') {
    const auth = e.request.headers.find(h => h.name.toLowerCase() === 'authorization');
    if (auth) { bearerToken = auth.value.replace('Bearer ', ''); break; }
  }
}

function signHeaders(body, nonce) {
  const ts = Date.now().toString();
  const payload = JSON.stringify(body);
  const message = `${ts}.${nonce}.${payload}`;
  const sig = createHmac('sha256', SECRET).update(message).digest('hex');
  return {
    'x-signature': sig,
    'x-timestamp': ts,
    'x-nonce': nonce,
    'content-type': 'application/json',
    authorization: `Bearer ${bearerToken}`,
    origin: 'https://asitha.top',
    referer: 'https://asitha.top/',
  };
}

// Step 1: Solve hCaptcha via hsolver.online
console.log('=== Step 1: createTask (hCaptcha) ===');
const createRes = await fetch('https://hsolver.online/createTask', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    clientKey: HSOLVER_KEY,
    task: {
      type: 'HCaptchaTask',
      websiteURL: 'https://asitha.top/channel-manager',
      websiteKey: '3acc5934-433c-46a8-82ba-51c03050c64a',
      proxy: 'direct://',
    }
  })
});
const createData = await createRes.json().catch(() => null);
console.log('HTTP:', createRes.status);
console.log('response:', JSON.stringify(createData).slice(0, 300));

if (createData?.errorCode) {
  console.log('ERROR - cannot proceed:', createData.errorDescription);
  process.exit(1);
}

const taskId = createData?.taskId || createData?.task_id;
if (!taskId) {
  // Maybe solution came inline
  if (createData?.solution) {
    console.log('Solution inline!');
    const captchaToken = createData.solution.gRecaptchaResponse || createData.solution.token || '';
    console.log('token length:', captchaToken.length);
    await doReact(captchaToken);
    process.exit(0);
  }
  console.log('No taskId returned, cannot proceed');
  process.exit(1);
}

console.log('taskId:', taskId);
console.log();

// Step 2: Poll for result
console.log('=== Step 2: Polling getTaskResult ===');
let captchaToken = '';
for (let i = 0; i < 40; i++) {
  await new Promise(r => setTimeout(r, 3000));
  const pollRes = await fetch('https://hsolver.online/getTaskResult', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientKey: HSOLVER_KEY, taskId })
  });
  const pollData = await pollRes.json().catch(() => null);
  const status = pollData?.status || 'unknown';
  console.log(`  poll ${i + 1}: ${status}`);
  
  if (status === 'ready' || pollData?.solution) {
    captchaToken = pollData.solution?.gRecaptchaResponse || pollData.solution?.token || '';
    console.log('  SOLVED! token length:', captchaToken.length);
    console.log('  token prefix:', captchaToken.slice(0, 30) + '...');
    break;
  }
  if (status === 'failed' || pollData?.errorId > 0) {
    console.log('  FAILED:', JSON.stringify(pollData).slice(0, 200));
    process.exit(1);
  }
}

if (!captchaToken) {
  console.log('Timed out waiting for captcha solve');
  process.exit(1);
}

await doReact(captchaToken);

async function doReact(hcaptchaToken) {
  console.log();
  // Step 3: security/init
  console.log('=== Step 3: security/init ===');
  const initRes = await fetch(`${API}/security/init`, {
    headers: { authorization: `Bearer ${bearerToken}`, origin: 'https://asitha.top', referer: 'https://asitha.top/' },
  });
  const initData = await initRes.json();
  const nonce1 = initData.nonce;
  const setCookie1 = initRes.headers.getSetCookie?.() || [];
  const cookie1 = (setCookie1.find(c => c.startsWith('x_sec_session=')) || '').split(';')[0];
  console.log('nonce:', nonce1);
  console.log('cookie:', cookie1.slice(0, 50) + '...');
  console.log();

  // Step 4: get-temp-token
  console.log('=== Step 4: get-temp-token ===');
  const body4 = { recaptcha_token: hcaptchaToken };
  const headers4 = signHeaders(body4, nonce1);
  headers4.cookie = cookie1;
  const tempRes = await fetch(`${API}/user/get-temp-token`, {
    method: 'POST',
    headers: headers4,
    body: JSON.stringify(body4),
  });
  const tempData = await tempRes.json().catch(() => null);
  console.log('HTTP:', tempRes.status);
  console.log('response:', JSON.stringify(tempData).slice(0, 200));
  
  if (tempRes.status !== 200 || !tempData?.token) {
    console.log('Failed to get temp token');
    return;
  }
  const tempToken = tempData.token;
  console.log('temp token length:', tempToken.length);
  console.log();

  // Step 5: security/init (fresh nonce for react)
  console.log('=== Step 5: fresh security/init for react ===');
  const initRes2 = await fetch(`${API}/security/init`, {
    headers: { authorization: `Bearer ${bearerToken}`, origin: 'https://asitha.top', referer: 'https://asitha.top/' },
  });
  const initData2 = await initRes2.json();
  const nonce2 = initData2.nonce;
  const setCookie2 = initRes2.headers.getSetCookie?.() || [];
  const cookie2 = (setCookie2.find(c => c.startsWith('x_sec_session=')) || '').split(';')[0];
  console.log('nonce:', nonce2);
  console.log();

  // Step 6: react-to-post
  console.log('=== Step 6: react-to-post ===');
  const body6 = {
    post_link: 'https://whatsapp.com/channel/0029Vb6xflDKAwEmGOltPU2X/6703',
    reacts: '🦄',
    count: '1'
  };
  const headers6 = signHeaders(body6, nonce2);
  headers6.cookie = cookie2;
  const reactRes = await fetch(`${API}/channel/react-to-post?apiKey=${tempToken}`, {
    method: 'POST',
    headers: headers6,
    body: JSON.stringify(body6),
  });
  const reactData = await reactRes.json().catch(() => null);
  console.log('HTTP:', reactRes.status);
  console.log('response:', JSON.stringify(reactData).slice(0, 300));
  
  if (reactRes.status === 200) {
    console.log();
    console.log('SUCCESS! Full flow working end-to-end.');
  }
}
