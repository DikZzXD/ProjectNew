import { readFileSync } from 'node:fs';

// Try HCaptchaTaskProxyless first
console.log('=== hcaptcha solve (HCaptchaTaskProxyless) ===');
const taskRes = await fetch('https://hsolver.online/createTask', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    clientKey: 'HS-77T3UVE8AJT5QR',
    task: {
      type: 'HCaptchaTaskProxyless',
      websiteURL: 'https://asitha.top/channel-manager',
      websiteKey: '3acc5934-433c-46a8-82ba-51c03050c64a',
    }
  })
});
const taskData = await taskRes.json().catch(() => null);
console.log('createTask HTTP:', taskRes.status);
console.log('response:', JSON.stringify(taskData).slice(0, 400));
console.log();

if (taskData?.errorId || taskData?.errorCode) {
  // Try with a dummy proxy
  console.log('=== Retry with proxy field ===');
  const taskRes2 = await fetch('https://hsolver.online/createTask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clientKey: 'HS-77T3UVE8AJT5QR',
      task: {
        type: 'HCaptchaTask',
        websiteURL: 'https://asitha.top/channel-manager',
        websiteKey: '3acc5934-433c-46a8-82ba-51c03050c64a',
        proxy: 'direct://'
      }
    })
  });
  const taskData2 = await taskRes2.json().catch(() => null);
  console.log('createTask HTTP:', taskRes2.status);
  console.log('response:', JSON.stringify(taskData2).slice(0, 400));

  if (taskData2?.errorId || taskData2?.errorCode) {
    // Try another proxy format
    console.log();
    console.log('=== Retry with empty proxy string ===');
    const taskRes3 = await fetch('https://hsolver.online/createTask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientKey: 'HS-77T3UVE8AJT5QR',
        task: {
          type: 'HCaptchaTask',
          websiteURL: 'https://asitha.top/channel-manager',
          websiteKey: '3acc5934-433c-46a8-82ba-51c03050c64a',
          proxy: ''
        }
      })
    });
    const taskData3 = await taskRes3.json().catch(() => null);
    console.log('createTask HTTP:', taskRes3.status);
    console.log('response:', JSON.stringify(taskData3).slice(0, 400));
  }
}

// If we got a taskId from any attempt, poll it
const taskId = taskData?.taskId || taskData?.task_id;
if (taskId) {
  console.log('taskId:', taskId, '- polling...');
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const pollRes = await fetch('https://hsolver.online/getTaskResult', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientKey: 'HS-77T3UVE8AJT5QR', taskId })
    });
    const pollData = await pollRes.json().catch(() => null);
    console.log(`  poll ${i + 1}:`, pollData?.status || pollRes.status, JSON.stringify(pollData).slice(0, 200));
    if (pollData?.status === 'ready' || pollData?.solution) {
      const captchaToken = pollData.solution?.gRecaptchaResponse || pollData.solution?.token || '';
      console.log('  SOLVED! token length:', captchaToken.length);
      break;
    }
    if (pollData?.status === 'failed' || pollData?.errorId) {
      console.log('  FAILED');
      break;
    }
  }
}
