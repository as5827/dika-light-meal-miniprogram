// 用已安装的 Edge 渲染 PDF，并加上页眉页脚页码。
// 零第三方依赖：走 Edge 自带的 DevTools 协议（CDP），用 Node 18+ 内置的 WebSocket，
// 不需要 puppeteer / puppeteer-core。这样评审机 clone 下来即可复现文档构建。
//
// 用法：node scripts/print-pdf.js <本地html路径|http地址> <输出pdf> [页眉标题]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

const [, , input, out, title] = process.argv;
if (!input || !out) {
  console.error('usage: node print-pdf.js <input.html|url> <out.pdf> [headerTitle]');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  for (const p of EDGE_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('没找到 Edge/Chrome，请修改 EDGE_CANDIDATES');
}

function toFileUrl(p) {
  if (/^https?:/i.test(p)) return p;
  const abs = path.resolve(p).replace(/\\/g, '/');
  const parts = abs.split('/');
  const drive = parts.shift();                        // 保留盘符 "D:"，不能编码
  return 'file:///' + drive + '/' + parts.map(encodeURIComponent).join('/');
}

async function waitForPort(userDataDir, timeoutMs) {
  const flag = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(flag)) {
      const txt = fs.readFileSync(flag, 'utf8').split('\n');
      if (txt[0] && txt[0].trim()) return Number(txt[0].trim());
    }
    await sleep(120);
  }
  throw new Error('等待浏览器调试端口超时');
}

async function getWsUrl(port) {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      const j = await res.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch (_) { /* 还没起来 */ }
    await sleep(150);
  }
  throw new Error('拿不到 webSocketDebuggerUrl');
}

function createClient(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });
  return (method, params, sessionId) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, {
        resolve,
        reject: (e) => reject(new Error(method + ': ' + e.message))
      });
      const payload = { id: mid, method, params: params || {} };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (pending.has(mid)) { pending.delete(mid); reject(new Error(method + ' 超时')); }
      }, 60000);
    });
}

(async () => {
  const browserPath = findBrowser();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printpdf-'));
  const child = spawn(browserPath, [
    '--headless=new',
    '--remote-debugging-port=0',
    '--user-data-dir=' + userDataDir,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    'about:blank'
  ], { stdio: 'ignore' });

  const cleanup = () => {
    try { child.kill(); } catch (_) { /* ignore */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  };

  try {
    const port = await waitForPort(userDataDir, 30000);
    const wsUrl = await getWsUrl(port);
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const send = createClient(ws);

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

    await send('Page.enable', {}, sessionId);
    const loaded = new Promise((resolve) => {
      const onMsg = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') {
          ws.removeEventListener('message', onMsg);
          resolve();
        }
      };
      ws.addEventListener('message', onMsg);
    });
    await send('Page.navigate', { url: toFileUrl(input) }, sessionId);
    await Promise.race([loaded, sleep(30000)]);
    await sleep(600); // 等字体与内联样式稳定

    const header =
      '<div style="width:100%;font-size:8px;color:#666;text-align:center;font-family:SimSun,serif;padding:0 20mm;">' +
      (title || '') + '</div>';
    const footer =
      '<div style="width:100%;font-size:8px;color:#666;text-align:center;font-family:SimSun,serif;">' +
      '第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</div>';

    // CDP 的页边距只接受「英寸」数字，这里把原来的毫米值换算过来
    const mm = (v) => Math.round((v / 25.4) * 10000) / 10000;

    const { data } = await send('Page.printToPDF', {
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: header,
      footerTemplate: footer,
      paperWidth: 8.27,
      paperHeight: 11.69,
      marginTop: mm(22),
      marginBottom: mm(18),
      marginLeft: mm(22),
      marginRight: mm(20)
    }, sessionId);

    fs.writeFileSync(out, Buffer.from(data, 'base64'));
    ws.close();
    console.log('done:', out);
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error('fail:', e.message);
  process.exit(1);
});
