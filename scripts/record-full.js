// 定时器驱动整段录制（5 分钟演示 + 2 分 30 秒 AI 协同），并输出时间轴给配音对齐
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3912';
const CAP = 'C:\\Users\\Lenovo\\Videos\\Captures';
const OUT_DIR = 'D:\\Y\\video-build';
const WS = process.env.WS || '1291,726';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hotkey() {
  const ps = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class HKF {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
  public static void Fire() {
    keybd_event(0x5B,0,0,IntPtr.Zero); keybd_event(0x12,0,0,IntPtr.Zero); keybd_event(0x52,0,0,IntPtr.Zero);
    System.Threading.Thread.Sleep(80);
    keybd_event(0x52,0,2,IntPtr.Zero); keybd_event(0x12,0,2,IntPtr.Zero); keybd_event(0x5B,0,2,IntPtr.Zero);
  }
}
'@
[HKF]::Fire()`;
  const f = path.join(process.env.TEMP, 'hkf.ps1');
  fs.writeFileSync(f, ps, 'utf8');
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${f}"`, { stdio: 'ignore' });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const before = fs.readdirSync(CAP).filter((f) => f.endsWith('.mp4'));

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: false,
    defaultViewport: { width: 1291, height: 726 },
    args: ['--window-size=' + WS, '--window-position=20,20', '--app=' + BASE + '/preview/index.html',
           '--user-data-dir=' + process.env.TEMP + '\\edge-final3']
  });
  const page = (await browser.pages())[0];
  await page.goto(BASE + '/preview/index.html', { waitUntil: 'networkidle0' });
  await sleep(1500);

  console.log('REC START');
  if (!process.env.NO_HOTKEY) hotkey();
  const t0 = Date.now();
  await sleep(2800);

  const slowScroll = async (from, to, ms) => {
    const steps = 22;
    for (let i = 1; i <= steps; i++) {
      await page.evaluate((y) => window.scrollTo(0, y), from + ((to - from) * i) / steps);
      await sleep(ms / steps);
    }
  };

  const stages = [
    { name: 'opening', ms: 8000, run: async () => { await page.goto(BASE + '/docs/video/title.png', { waitUntil: 'domcontentloaded' }); } },
    { name: 'menu', ms: 80000, run: async () => {
        await page.goto(BASE + '/preview/index.html', { waitUntil: 'networkidle0' });
        await sleep(2500);
        try {
          const cats = await page.$$('.cat-item');
          if (cats[1]) { await cats[1].click(); await sleep(2500); }
          if (cats[2]) { await cats[2].click(); await sleep(2500); }
          if (cats[0]) { await cats[0].click(); await sleep(2000); }
        } catch (e) {}
        await slowScroll(0, 420, 12000);
        await sleep(6000);
        await slowScroll(420, 0, 9000);
      } },
    { name: 'nlorder', ms: 75000, run: async () => {
        try {
          await page.click('#nlInput');
          await sleep(900);
          await page.type('#nlInput', '我想吃500千卡以内、高蛋白、不要香菜，预算40', { delay: 95 });
          await sleep(1800);
          await page.click('#nlBtn');
          await page.waitForFunction(() => {
            const el = document.getElementById('nlResult');
            return el && el.style.display !== 'none' && el.innerText.includes('命中');
          }, { timeout: 25000 });
        } catch (e) { console.log('NL 跳过', e.message); }
        await sleep(30000);
      } },
    { name: 'plan', ms: 60000, run: async () => {
        try {
          const entry = await page.$('#planEntry');
          if (entry) { await entry.click(); await sleep(3000); }
          const gen = await page.$('#planSubmit, .plan-submit, #genPlan, .plan-generate');
          if (gen) { await gen.click(); await sleep(7000); }
        } catch (e) {}
        await slowScroll(0, 380, 12000);
      } },
    { name: 'board', ms: 80000, run: async () => {
        await page.goto(BASE + '/admin/index.html', { waitUntil: 'domcontentloaded' });
        await sleep(2500);
        try {
          const pass = await page.$('#loginPass');
          if (pass) { await pass.click(); await page.type('#loginPass', 'dika2026', { delay: 70 }); await sleep(900); await page.click('#loginBtn'); await sleep(4500); }
          const b = await page.$('#board');
          if (b) { await page.evaluate(() => document.getElementById('board').scrollIntoView({ behavior: 'smooth', block: 'center' })); await sleep(4000); }
          const ins = await page.$('#boardInsight');
          if (ins) { await ins.click(); await sleep(12000); }
        } catch (e) { console.log('看板跳过', e.message); }
      } },
    { name: 'prompt', ms: 90000, run: async () => { await page.goto(BASE + '/docs/video/demo-prompt.html', { waitUntil: 'domcontentloaded' }); await sleep(3000); } },
    { name: 'fix', ms: 62000, run: async () => {
        await page.goto(BASE + '/docs/video/demo-fix.html', { waitUntil: 'domcontentloaded' });
        await sleep(5000);
        await slowScroll(0, 300, 14000);
      } },
    { name: 'ending', ms: 8000, run: async () => { await page.goto(BASE + '/docs/video/end.png', { waitUntil: 'domcontentloaded' }); } }
  ];

  const timeline = [{ name: 'preroll', start: 0, end: 2.8 }];
  for (const s of stages) {
    const start = (Date.now() - t0) / 1000;
    try { await s.run(); } catch (e) { console.log(s.name + ' 出错：' + e.message); }
    const used = (Date.now() - t0) / 1000 - start;
    const left = s.ms / 1000 - used;
    if (left > 0) await sleep(left * 1000);
    const end = (Date.now() - t0) / 1000;
    timeline.push({ name: s.name, start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10 });
    console.log(`${s.name}: ${start.toFixed(1)} → ${end.toFixed(1)}s`);
  }

  await sleep(600);
  if (!process.env.NO_HOTKEY) hotkey();
  const total = (Date.now() - t0) / 1000;
  console.log('REC STOP, 总长约 ' + total.toFixed(1) + 's');

  await sleep(4000);
  const after = fs.readdirSync(CAP).filter((f) => f.endsWith('.mp4') && !before.includes(f));
  const newest = after
    .map((f) => ({ f, t: fs.statSync(path.join(CAP, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0];

  const result = { video: newest ? path.join(CAP, newest.f) : null, total, timeline };
  fs.writeFileSync(path.join(OUT_DIR, 'timeline.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log('VIDEO:' + result.video);
  await browser.close();
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
