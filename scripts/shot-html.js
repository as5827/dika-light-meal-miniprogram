#!/usr/bin/env node
/**
 * 把本地 HTML 按指定尺寸截成 PNG（零依赖，走 Edge/Chrome 的 CDP）。
 *
 *   node scripts/shot-html.js docs/video/title.html docs/video/title.png 1920 1080
 *
 * 用途：生成演示视频的片头卡、片尾卡、以及文档里要用的整屏截图。
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

const src = process.argv[2];
const out = process.argv[3];
const W = Number(process.argv[4] || 1920);
const H = Number(process.argv[5] || 1080);

if (!src || !out) {
  console.error('用法: node scripts/shot-html.js <input.html> <output.png> [宽] [高]');
  process.exit(1);
}

const browser = BROWSERS.find((p) => fs.existsSync(p));
if (!browser) {
  console.error('找不到 Edge 或 Chrome，请修改脚本里的 BROWSERS 路径');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPort(dir) {
  const f = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 200; i += 1) {
    if (fs.existsSync(f)) {
      const t = fs.readFileSync(f, 'utf8').split('\n')[0].trim();
      if (t) return Number(t);
    }
    await sleep(120);
  }
  throw new Error('等待调试端口超时');
}

function client(ws) {
  let id = 0;
  const pend = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id);
      pend.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  });
  return (method, params, sessionId) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pend.set(mid, { res, rej });
      const p = { id: mid, method, params: params || {} };
      if (sessionId) p.sessionId = sessionId;
      ws.send(JSON.stringify(p));
      setTimeout(() => {
        if (pend.has(mid)) {
          pend.delete(mid);
          rej(new Error(method + ' 超时'));
        }
      }, 30000);
    });
}

(async () => {
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-'));
  const child = spawn(
    browser,
    ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + udd,
      '--no-first-run', '--no-default-browser-check', '--disable-gpu',
      '--hide-scrollbars', `--window-size=${W},${H}`, 'about:blank'],
    { stdio: 'ignore' }
  );
  try {
    const port = await waitPort(udd);
    let wsUrl;
    for (let i = 0; i < 60; i += 1) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/version`);
        const j = await r.json();
        if (j.webSocketDebuggerUrl) {
          wsUrl = j.webSocketDebuggerUrl;
          break;
        }
      } catch (e) {
        /* 端口还没起来 */
      }
      await sleep(150);
    }
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const send = client(ws);
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride',
      { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sessionId);

    const url = 'file:///' + path.resolve(src).replace(/\\/g, '/');
    await send('Page.navigate', { url }, sessionId);
    await sleep(700);

    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, Buffer.from(data, 'base64'));
    console.log(`done: ${out} (${W}x${H})`);
    ws.close();
  } finally {
    try { child.kill(); } catch (e) { /* 已退出 */ }
    try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }
})().catch((e) => {
  console.error('截图失败: ' + e.message);
  process.exit(1);
});
