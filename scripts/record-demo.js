// 录一段真实操作演示：启动可见浏览器 → 触发 Game Bar 录制 → 演一遍点餐与一句话点餐 → 停止
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CAP_DIR = 'C:\\Users\\Lenovo\\Videos\\Captures';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hotkey() {
  // 通过 PowerShell 发送 Win+Alt+R
  const ps = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class HK {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
  public static void Fire() {
    keybd_event(0x5B,0,0,IntPtr.Zero); keybd_event(0x12,0,0,IntPtr.Zero); keybd_event(0x52,0,0,IntPtr.Zero);
    System.Threading.Thread.Sleep(80);
    keybd_event(0x52,0,2,IntPtr.Zero); keybd_event(0x12,0,2,IntPtr.Zero); keybd_event(0x5B,0,2,IntPtr.Zero);
  }
}
'@
[HK]::Fire()
`;
  fs.writeFileSync(path.join(process.env.TEMP, 'hk.ps1'), ps, 'utf8');
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${path.join(process.env.TEMP, 'hk.ps1')}"`, { stdio: 'ignore' });
}

(async () => {
  const before = fs.readdirSync(CAP_DIR).filter((f) => f.endsWith('.mp4'));

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: false,
    defaultViewport: null,
    args: [(process.env.WS ? '--window-size=' + process.env.WS : '--window-size=1280,760'), '--window-position=40,40', '--app=http://127.0.0.1:3912/preview/index.html', '--user-data-dir=' + process.env.TEMP + '\\edge-rec']
  });

  const page = (await browser.pages())[0] || (await browser.newPage());
  await page.goto('http://127.0.0.1:3912/preview/index.html', { waitUntil: 'networkidle0' });
  await sleep(2500);

  console.log('开始录制…');
  hotkey();
  await sleep(2500);

  // 1) 切一个类目、加两道菜
  try {
    const cats = await page.$$('.cat-item');
    if (cats[2]) { await cats[2].click(); await sleep(1200); }
    const addBtns = await page.$$('.dish-add, .add-btn, .plus');
    if (addBtns[0]) { await addBtns[0].click(); await sleep(900); }
    if (addBtns[1]) { await addBtns[1].click(); await sleep(1200); }
  } catch (e) {
    console.log('点餐操作跳过:', e.message);
  }

  // 2) 回到第一个类目，滚到顶部
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await sleep(1200);

  // 3) 一句话点餐
  try {
    await page.click('#nlInput');
    await page.type('#nlInput', '我想吃500千卡以内、高蛋白、不要香菜，预算40', { delay: 55 });
    await sleep(900);
    await page.click('#nlBtn');
    await page.waitForFunction(() => {
      const el = document.getElementById('nlResult');
      return el && el.style.display !== 'none' && el.innerText.includes('命中');
    }, { timeout: 20000 });
    await sleep(2500);
  } catch (e) {
    console.log('一句话点餐失败:', e.message);
  }

  // 4) 停一下，让结果留在画面上
  await sleep(3000);
  hotkey();
  await sleep(3000);

  const after = fs.readdirSync(CAP_DIR).filter((f) => f.endsWith('.mp4') && !before.includes(f));
  console.log('新录像:', after.join(', ') || '(没有新文件)');

  await browser.close();
})().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
