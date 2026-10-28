const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'menu.json');
const ORDERS_FILE = path.join(ROOT, 'data', 'orders.json');
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

/* ---------- 订单存储 ---------- */

const MAX_ORDERS = 2000;
const ORDER_STATUS = ['pending', 'accepted', 'done', 'canceled'];
const DEFAULT_FEES = { deliveryFee: 500, packFee: 200, freeDeliveryThreshold: 5800 };

const readOrders = () => {
  try {
    const list = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return []; // 首次运行时文件不存在
  }
};

const writeOrders = (list) => {
  const tmp = ORDERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, ORDERS_FILE);
};

const pad2 = (n) => String(n).padStart(2, '0');

// 订单号：yyyyMMddHHmmss-4位随机，便于人工核对与排序
const nextOrderId = () => {
  const d = new Date();
  const stamp =
    d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
    pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  return stamp + '-' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
};

const calcFees = (subtotal, fees) => {
  const conf = Object.assign({}, DEFAULT_FEES, fees || {});
  const delivery = subtotal >= conf.freeDeliveryThreshold ? 0 : conf.deliveryFee;
  return { delivery, pack: conf.packFee };
};

const asInt = (v, min, max) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;

const asStr = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

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

  // 下单：服务端重算金额、校验库存并扣减
  if (req.method === 'POST' && url.startsWith('/api/orders')) {
    let payload;
    try {
      payload = JSON.parse(await readBody(req, 256 * 1024));
    } catch (e) {
      const tooLarge = e.message === 'BODY_TOO_LARGE';
      sendJson(res, tooLarge ? 413 : 400, {
        code: tooLarge ? 413 : 400,
        message: tooLarge ? '订单内容过大' : '请求体不是合法 JSON'
      });
      return;
    }

    const items = Array.isArray(payload.items) ? payload.items.slice(0, 50) : [];
    if (!items.length) {
      sendJson(res, 400, { code: 400, message: '订单里没有商品' });
      return;
    }

    const addr = payload.address || {};
    const address = {
      name: asStr(addr.name, 20),
      phone: asStr(addr.phone, 20),
      building: asStr(addr.building, 40),
      room: asStr(addr.room, 20)
    };
    if (!address.name || !/^1\d{10}$/.test(address.phone) || !address.building || !address.room) {
      sendJson(res, 400, { code: 400, message: '收货地址不完整，或手机号不是 11 位' });
      return;
    }

    let menu;
    try {
      menu = readMenu();
    } catch (e) {
      sendJson(res, 500, { code: 500, message: '读取菜单失败' });
      return;
    }

    const normalized = [];
    for (const raw of items) {
      const dish = menu.dishes.find((d) => d.id === raw.dishId);
      if (!dish) {
        sendJson(res, 400, { code: 400, message: '菜品不存在：' + String(raw.dishId).slice(0, 20) });
        return;
      }
      const qty = asInt(raw.qty, 1, 99);
      if (qty === null) {
        sendJson(res, 400, { code: 400, message: '「' + dish.name + '」数量不合法' });
        return;
      }
      const unitPrice = asInt(raw.unitPrice, 0, 1000000);
      if (unitPrice === null || unitPrice < dish.price) {
        sendJson(res, 400, { code: 400, message: '「' + dish.name + '」价格异常' });
        return;
      }
      if (dish.stock < qty) {
        sendJson(res, 409, { code: 409, message: '「' + dish.name + '」库存不足，仅剩 ' + dish.stock + ' 份' });
        return;
      }
      normalized.push({
        dishId: dish.id,
        name: dish.name,
        specDesc: asStr(raw.specDesc, 100),
        unitPrice,
        qty,
        calorie: dish.calorie,
        amount: unitPrice * qty
      });
    }

    const subtotal = normalized.reduce((s, i) => s + i.amount, 0);
    const fees = calcFees(subtotal, menu.fees);
    const now = new Date().toISOString();
    const order = {
      id: nextOrderId(),
      status: 'pending',
      items: normalized,
      address,
      remark: asStr(payload.remark, 200),
      subtotal,
      deliveryFee: fees.delivery,
      packFee: fees.pack,
      total: subtotal + fees.delivery + fees.pack,
      totalCalorie: normalized.reduce((s, i) => s + i.calorie * i.qty, 0),
      itemCount: normalized.reduce((s, i) => s + i.qty, 0),
      createdAt: now,
      updatedAt: now
    };

    normalized.forEach((i) => {
      const dish = menu.dishes.find((d) => d.id === i.dishId);
      dish.stock = Math.max(0, dish.stock - i.qty);
    });

    try {
      writeMenu(menu);                       // 先扣库存
      const orders = readOrders();
      orders.unshift(order);
      writeOrders(orders.slice(0, MAX_ORDERS)); // 再落订单
    } catch (e) {
      sendJson(res, 500, { code: 500, message: '下单失败，请重试' });
      return;
    }

    sendJson(res, 200, {
      code: 0,
      data: {
        id: order.id,
        status: order.status,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        packFee: order.packFee,
        total: order.total,
        totalCalorie: order.totalCalorie,
        itemCount: order.itemCount,
        createdAt: order.createdAt
      }
    });
    return;
  }

  // 订单列表（后台用，按创建时间倒序）
  if (req.method === 'GET' && url.startsWith('/api/orders')) {
    const query = url.split('?')[1] || '';
    const matched = /(?:^|&)limit=(\d+)/.exec(query);
    const limit = Math.min(Math.max(parseInt(matched ? matched[1] : '50', 10) || 50, 1), 200);
    try {
      sendJson(res, 200, { code: 0, data: readOrders().slice(0, limit) });
    } catch (e) {
      sendJson(res, 500, { code: 500, message: '读取订单失败' });
    }
    return;
  }

  // 订单状态流转：接单 / 完成 / 取消
  if (req.method === 'PUT' && url.startsWith('/api/orders/')) {
    const id = decodeURIComponent(url.slice('/api/orders/'.length).split('?')[0]);
    let payload;
    try {
      payload = JSON.parse(await readBody(req, 8 * 1024));
    } catch (e) {
      sendJson(res, 400, { code: 400, message: '请求体不是合法 JSON' });
      return;
    }
    const next = asStr(payload.status, 20);
    if (next === 'pending' || ORDER_STATUS.indexOf(next) === -1) {
      sendJson(res, 400, { code: 400, message: '不支持的状态流转' });
      return;
    }
    try {
      const orders = readOrders();
      const order = orders.find((o) => o.id === id);
      if (!order) {
        sendJson(res, 404, { code: 404, message: '订单不存在' });
        return;
      }
      order.status = next;
      order.updatedAt = new Date().toISOString();
      writeOrders(orders);
      sendJson(res, 200, { code: 0, data: order });
    } catch (e) {
      sendJson(res, 500, { code: 500, message: '更新订单失败' });
    }
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
