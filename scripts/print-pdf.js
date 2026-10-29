// 用已安装的 Edge 渲染 PDF，并加上页眉页脚页码（Chromium 自带能力，无需 LibreOffice）
const path = require('path');
const puppeteer = require('puppeteer-core');

const [, , url, out, title] = process.argv;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu']
  });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.pdf({
    path: out,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate:
      '<div style="width:100%;font-size:8px;color:#666;text-align:center;font-family:SimSun,serif;padding:0 20mm;">' +
      (title || '') +
      '</div>',
    footerTemplate:
      '<div style="width:100%;font-size:8px;color:#666;text-align:center;font-family:SimSun,serif;">' +
      '第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</div>',
    margin: { top: '22mm', bottom: '18mm', left: '22mm', right: '20mm' }
  });
  await browser.close();
  console.log('done:', out);
})().catch((e) => {
  console.error('fail:', e.message);
  process.exit(1);
});
