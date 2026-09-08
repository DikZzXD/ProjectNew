import { readFileSync } from 'node:fs';

const har = JSON.parse(readFileSync('test/asithatop.har', 'utf8'));

// Extract token inline
let token = '';
for (const e of har.log.entries) {
  const u = new URL(e.request.url);
  if (u.host === 'back.asitha.top' && u.pathname === '/api/auth/user' && e.request.method === 'GET') {
    const auth = e.request.headers.find(h => h.name.toLowerCase() === 'authorization');
    if (auth) { token = auth.value.replace('Bearer ', ''); break; }
  }
}

if (!token) { console.log('ERROR: no token found in HAR'); process.exit(1); }
console.log('Token found, length:', token.length);
console.log();

// Step 1: /api/auth/user
console.log('=== Step 1: GET /api/auth/user ===');
const res1 = await fetch('https://back.asitha.top/api/auth/user', {
  headers: { authorization: `Bearer ${token}`, accept: 'application/json' }
});
const data1 = await res1.json().catch(() => null);
console.log('HTTP:', res1.status);
if (data1?.user) {
  console.log('username:', data1.user.username);
  console.log('coins:', data1.user.coins);
  console.log('apiKey present:', !!data1.user.apiKey);
} else {
  console.log('body:', JSON.stringify(data1).slice(0, 200));
}
console.log();

// Step 2: /api/security/init
console.log('=== Step 2: GET /api/security/init ===');
const res2 = await fetch('https://back.asitha.top/api/security/init', {
  headers: { authorization: `Bearer ${token}`, accept: 'application/json' }
});
const data2 = await res2.json().catch(() => null);
console.log('HTTP:', res2.status);
console.log('nonce:', data2?.nonce ? data2.nonce.slice(0, 12) + '...' : JSON.stringify(data2).slice(0, 100));
console.log();

// Step 3: Solve hcaptcha via hsolver.online
console.log('=== Step 3: hcaptcha solve via hsolver.online ===');
const taskRes = await fetch('https://hsolver.online/createTask', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    clientKey: 'HS-77T3UVE8AJT5QR',
    task: {
      type: 'HCaptchaTask',
      websiteURL: 'https://asitha.top/channel-manager',
      websiteKey: '3acc5934-433c-46a8-82ba-51c03050c64a',
    }
  })
});
const taskData = await taskRes.json().catch(() => null);
console.log('createTask HTTP:', taskRes.status);
console.log('createTask response:', JSON.stringify(taskData).slice(0, 300));

if (!taskData?.taskId && !taskData?.task_id && !taskData?.solution) {
  console.log('No taskId returned, checking if solution is inline...');
  console.log('Full response:', JSON.stringify(taskData).slice(0, 500));
  process.exit(0);
}

const taskId = taskData.taskId || taskData.task_id;

if (taskData?.solution?.gRecaptchaResponse || taskData?.solution?.token) {
  console.log('Solution returned inline!');
  const captchaToken = taskData.solution.gRecaptchaResponse || taskData.solution.token;
  console.log('captcha token length:', captchaToken.length);
  console.log('captcha token prefix:', captchaToken.slice(0, 40) + '...');
} else if (taskId) {
  // Poll for result
  console.log('taskId:', taskId, '- polling...');
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const pollRes = await fetch('https://hsolver.online/getTaskResult', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientKey: 'HS-77T3UVE8AJT5QR', taskId })
    });
    const pollData = await pollRes.json().catch(() => null);
    console.log(`  poll ${i + 1}:`, pollData?.status || pollRes.status, JSON.stringify(pollData).slice(0, 150));
    if (pollData?.status === 'ready' || pollData?.solution) {
      const captchaToken = pollData.solution?.gRecaptchaResponse || pollData.solution?.token || '';
      console.log('  SOLVED! token length:', captchaToken.length);
      console.log('  token prefix:', captchaToken.slice(0, 50) + '...');
      break;
    }
    if (pollData?.status === 'failed' || pollData?.errorId) {
      console.log('  FAILED:', JSON.stringify(pollData));
      break;
    }
  }
}
