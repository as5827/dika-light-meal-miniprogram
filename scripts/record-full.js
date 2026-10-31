// 定时器驱动的整段录制：每一段固定停留时长，动作失败也不影响总时长
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3912';
const CAP = 'C:\\Users\\Lenovo\\Videos\\Captures';
const WS = process.env.WS || '1291,726';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hotkey() {
  const ps = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class HKS {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
  public static void Fire() {
    keybd_event(0x5B,0,0,IntPtr.Zero); keybd_event(0x12,0,0,IntPtr.Zero); keybd_event(0x52,0,0,IntPtr.Zero);
    System.Threading.Thread.Sleep(80);
    keybd_event(0x52,0,2,IntPtr.Zero); keybd_event(0x12,0,2,IntPtr.Zero); keybd_event(0x5B,0,2,IntPtr.Zero);
  }
}
'@
[HKS]::Fire()`;
  const f = path.join(process.env.TEMP, 'hks.ps1');
  fs.writeFileSync(f, ps, 'utf8');
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${f}"`, { stdio: 'ignore' });
}

(async () => {
  const before = fs.readdirSync(CAP).filter((f) => f.endsWith('.mp4'));
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: false,
    defaultViewport: { width: 1291, height: 726 },
    args: ['--window-size=' + WS, '--window-position=20,20', '--app=' + BASE + '/preview/index.html',
           '--user-data-dir=' + process.env.TEMP + '\\edge-rec-final2']
  });
  const page = (await browser.pages())[0];
  await page.goto(BASE + '/preview/index.html', { waitUntil: 'networkidle0' });
  await sleep(1500);

  console.log('REC START');
  hotkey();
  await sleep(2800);

  const slowScroll = async (from, to, ms) => {
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      await page.evaluate((y) => window.scrollTo(0, y), from + ((to - from) * i) / steps);
      await sleep(ms / steps);
    }
  };

  // ---------- 演示各段 ----------
  const stages = [
    { name: '片头', ms: 12000, run: async () => { await page.goto(BASE + '/docs/video/title.png', { waitUntil: 'domcontentloaded' }); } },
    { name: '点餐页', ms: 55000, run: async () => {
        await page.goto(BASE + '/preview/index.html', { waitUntil: 'networkidle0' });
        await sleep(2500);
        try {
          const cats = await page.$$('.cat-item');
          if (cats[1]) { await cats[1].click(); await sleep(2000); }
          if (cats[2]) { await cats[2].click(); await sleep(2000); }
        } catch (e) {}
        await slowScroll(0, 420, 9000);
        await slowScroll(420, 0, 7000);
      } },
    { name: '一句话点餐', ms: 52000, run: async () => {
        try {
          await page.click('#nlInput');
          await sleep(800);
          await page.type('#nlInput', '我想吃500千卡以内、高蛋白、不要香菜，预算40', { delay: 85 });
          await sleep(1500);
          await page.click('#nlBtn');
          await page.waitForFunction(() => {
            const el = document.getElementById('nlResult');
            return el && el.style.display !== 'none' && el.innerText.includes('命中');
          }, { timeout: 25000 });
        } catch (e) { console.log('NL 跳过', e.message); }
        await sleep(14000);
      } },
    { name: '后台看板', ms: 50000, run: async () => {
        await page.goto(BASE + '/admin/index.html', { waitUntil: 'domcontentloaded' });
        await sleep(2500);
        try {
          const pass = await page.$('#loginPass');
          if (pass) { await pass.click(); await page.type('#loginPass', 'dika2026', { delay: 70 }); await sleep(800); await page.click('#loginBtn'); await sleep(4000); }
          const b = await page.$('#board');
          if (b) { await page.evaluate(() => document.getElementById('board').scrollIntoView({ behavior: 'smooth', block: 'center' })); await sleep(3000); }
          const ins = await page.$('#boardInsight');
          if (ins) { await ins.click(); await sleep(9000); }
        } catch (e) { console.log('看板跳过', e.message); }
      } },
    { name: '套餐推荐', ms: 30000, run: async () => {
        await page.goto(BASE + '/preview/index.html', { waitUntil: 'domcontentloaded' });
        await sleep(1500);
        try {
          const entry = await page.$('#planEntry');
          if (entry) { await entry.click(); await sleep(2500); }
          const gen = await page.$('#planSubmit, .plan-submit, #genPlan, .plan-generate');
          if (gen) { await gen.click(); await sleep(6000); }
        } catch (e) {}
        await slowScroll(0, 360, 6000);
      } },
    { name: '提示词', ms: 90000, run: async () => { await page.goto(BASE + '/docs/video/demo-prompt.html', { waitUntil: 'domcontentloaded' }); } },
    { name: '修复与自测', ms: 80000, run: async () => {
        await page.goto(BASE + '/docs/video/demo-fix.html', { waitUntil: 'domcontentloaded' });
        await sleep(4000);
        await slowScroll(0, 420, 12000);
      } },
    { name: '片尾', ms: 12000, run: async () => { await page.goto(BASE + '/docs/video/end.png', { waitUntil: 'domcontentloaded' }); } }
  ];

  for (const s of stages) {
    const t0 = Date.now();
    try { await s.run(); } catch (e) { console.log(s.name + ' 出错：' + e.message); }
    const left = s.ms - (Date.now() - t0);
    console.log(`${s.name} 用时 ${Math.round((Date.now() - t0) / 1000)}s，补 ${Math.max(0, Math.round(left / 1000))}s`);
    if (left > 0) await sleep(left);
  }

  hotkey();
  console.log('REC STOP');
  await sleep(4500);

  const after = fs.readdirSync(CAP).filter((f) => f.endsWith('.mp4') && !before.includes(f));
  console.log('NEW:' + after.join('|'));
  await browser.close();
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
