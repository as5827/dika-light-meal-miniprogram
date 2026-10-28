const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'menu.json');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const PORT = Number(process.env.PORT) || 3000;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const readMenu = () => JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

const writeMenu = (menu) => {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(menu, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
};

const sendJson = (res, code, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
};

const readBody = (req, limit) => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > limit) {
      reject(new Error('BODY_TOO_LARGE'));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

const serveStatic = (res, urlPath) => {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/preview/index.html';
  if (rel === '/admin' || rel === '/admin/') rel = '/admin/index.html';
  if (rel.startsWith('/data') || rel.startsWith('/.trae') || rel.includes('..')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  const filePath = path.join(ROOT, rel);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found: ' + rel);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  });
};

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  // 读取整份菜单
  if (req.method === 'GET' && url.startsWith('/api/menu')) {
    try {
      sendJson(res, 200, { code: 0, data: readMenu() });
    } catch (e) {
      sendJson(res, 500, { code: 500, message: '读取菜单失败' });
    }
    return;
  }

  // 修改单个商品的图片 / 价格 / 库存 / 热量 / 名称 / 描述
  if (req.method === 'PUT' && url.startsWith('/api/dishes/')) {
    const id = decodeURIComponent(url.slice('/api/dishes/'.length).split('?')[0]);
    let payload;
    try {
      payload = JSON.parse(await readBody(req, 1024 * 64));
    } catch (e) {
      sendJson(res, 400, { code: 400, message: '请求体不是合法 JSON' });
      return;
    }
    try {
      const menu = readMenu();
      const dish = menu.dishes.find((d) => d.id === id);
      if (!dish) {
        sendJson(res, 404, { code: 404, message: '商品不存在' });
        return;
      }
      if (typeof payload.price === 'number' && Number.isInteger(payload.price) && payload.price >= 0) {
        dish.price = payload.price;
      }
      if (typeof payload.stock === 'number' && Number.isInteger(payload.stock) && payload.stock >= 0) {
        dish.stock = payload.stock;
      }
      if (typeof payload.calorie === 'number' && Number.isInteger(payload.calorie) && payload.calorie >= 0) {
        dish.calorie = payload.calorie;
      }
      if (typeof payload.image === 'string') {
        dish.image = payload.image;
      }
      if (typeof payload.name === 'string' && payload.name.trim()) {
        dish.name = payload.name.trim();
      }
      if (typeof payload.desc === 'string') {
        dish.desc = payload.desc;
      }
      writeMenu(menu);
      sendJson(res, 200, { code: 0, data: dish });
    } catch (e) {
      sendJson(res, 500, { code: 500, message: '保存失败' });
    }
    return;
  }

  // 上传图片：前端把文件读成 dataUrl 以 JSON 提交，避免引入 multipart 依赖
  if (req.method === 'POST' && url.startsWith('/api/upload')) {
    let payload;
    try {
      payload = JSON.parse(await readBody(req, 8 * 1024 * 1024));
    } catch (e) {
      sendJson(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, {
        code: e.message === 'BODY_TOO_LARGE' ? 413 : 400,
        message: e.message === 'BODY_TOO_LARGE' ? '图片过大，请压缩到 2MB 以内' : '请求体不是合法 JSON'
      });
      return;
    }
    const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/i.exec(payload.dataUrl || '');
    if (!match) {
      sendJson(res, 400, { code: 400, message: '仅支持 png / jpg / webp / gif' });
      return;
    }
    let ext = match[1].toLowerCase();
    if (ext === 'jpeg') ext = 'jpg';
    const buf = Buffer.from(match[2], 'base64');
    if (buf.length > 2 * 1024 * 1024) {
      sendJson(res, 413, { code: 413, message: '图片过大，请压缩到 2MB 以内' });
      return;
    }
    const safeBase = (payload.filename || 'img')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9一-龥_-]/g, '')
      .slice(0, 40) || 'img';
    const name = `${Date.now()}-${safeBase}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    sendJson(res, 200, { code: 0, data: { url: '/uploads/' + name, size: buf.length } });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(res, url);
    return;
  }

  sendJson(res, 405, { code: 405, message: 'Method Not Allowed' });
});

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`dika轻食 server running at http://localhost:${PORT}\n`);
  process.stdout.write(`点餐页  http://localhost:${PORT}/preview/index.html\n`);
  process.stdout.write(`后台    http://localhost:${PORT}/admin\n`);
});
