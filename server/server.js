const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const recommender = require('./recommender');
const intent = require('./intent');
const log = require('./logger');

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

/* ---------- 后台会话 ---------- */

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'dika2026';
const SESSION_COOKIE = 'dika_admin';
const SESSION_TTL = 8 * 60 * 60 * 1000;      // 8 小时，访问即续期
const LOGIN_MAX_FAILS = 5;                    // 同一 IP 连续失败次数上限
const LOGIN_LOCK_MS = 60 * 1000;              // 触发后锁定 60 秒

const sessions = new Map();   // token -> { user, expiresAt }
const loginFails = new Map(); // ip -> { count, lockUntil }

const parseCookies = (req) => {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
};

const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

const getSession = (req) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL; // 滑动续期
  return { token, user: session.user };
};

const requireAuth = (req, res) => {
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, { code: 401, message: '请先登录后台' });
    return null;
  }
  return session;
};

const maskPhone = (phone) => String(phone || '').replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');

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
  const clientIp = (req.socket && req.socket.remoteAddress) || 'unknown';

  // 请求日志：只记 /api/*，静态资源不写，避免日志被页面和图片淹没
  const startedAt = Date.now();
  res.on('finish', () => {
    if (!url.startsWith('/api/')) return;
    log.info('http', {
      method: req.method,
      path: url.split('?')[0],
      status: res.statusCode,
      ms: Date.now() - startedAt,
      ip: clientIp
    });
  });

  /* ---------- 后台登录 ---------- */

  if (req.method === 'POST' && url === '/api/login') {
    let payload;
    try {
      payload = JSON.parse(await readBody(req, 8 * 1024));
    } catch (e) {
      sendJson(res, 400, { code: 400, message: '请求体不是合法 JSON' });
      return;
    }

    const record = loginFails.get(clientIp);
    if (record && record.lockUntil > Date.now()) {
      const left = Math.ceil((record.lockUntil - Date.now()) / 1000);
      log.warn('auth.locked', { ip: clientIp, leftSeconds: left });
      sendJson(res, 429, { code: 429, message: `登录失败次数过多，请 ${left} 秒后再试` });
      return;
    }

    const username = asStr(payload.username, 40);
    const password = typeof payload.password === 'string' ? payload.password : '';
    if (username === ADMIN_USER && password && safeEqual(password, ADMIN_PASSWORD)) {
      loginFails.delete(clientIp);
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, { user: username, expiresAt: Date.now() + SESSION_TTL });
      log.info('auth.login', { ok: true, ip: clientIp, user: username });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}`
      });
      res.end(JSON.stringify({ code: 0, data: { user: username, expiresIn: SESSION_TTL } }));
      return;
    }

    const fail = loginFails.get(clientIp) || { count: 0, lockUntil: 0 };
    fail.count += 1;
    if (fail.count >= LOGIN_MAX_FAILS) {
      fail.lockUntil = Date.now() + LOGIN_LOCK_MS;
      fail.count = 0;
    }
    loginFails.set(clientIp, fail);
    log.warn('auth.login', { ok: false, ip: clientIp, user: username, fails: fail.count });
    sendJson(res, 401, { code: 401, message: '账号或密码不正确' });
    return;
  }

  if (req.method === 'POST' && url === '/api/logout') {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) sessions.delete(token);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
    });
    res.end(JSON.stringify({ code: 0 }));
    return;
  }

  if (req.method === 'GET' && url === '/api/session') {
    const session = getSession(req);
    if (!session) {
      sendJson(res, 401, { code: 401, message: '未登录' });
      return;
    }
    sendJson(res, 200, { code: 0, data: { user: session.user } });
    return;
  }

  // 读取整份菜单
  if (req.method === 'GET' && url.startsWith('/api/menu')) {
    try {
      sendJson(res, 200, { code: 0, data: readMenu() });
    } catch (e) {
      sendJson(res, 500, { code: 500, message: '读取菜单失败' });
    }
    return;
  }

  // 推荐引擎的可选项（性别 / 活动量 / 目标），前端据此渲染表单，两端保持一致
  if (req.method === 'GET' && url.startsWith('/api/recommend/options')) {
    sendJson(res, 200, { code: 0, data: recommender.options() });
    return;
  }

  // 个性化减脂套餐推荐
  if (req.method === 'POST' && url.startsWith('/api/recommend')) {
    let payload;
    try {
      payload = JSON.parse(await readBody(req, 16 * 1024));
    } catch (e) {
      const tooLarge = e.message === 'BODY_TOO_LARGE';
      sendJson(res, tooLarge ? 413 : 400, {
        code: tooLarge ? 413 : 400,
        message: tooLarge ? '请求内容过大' : '请求体不是合法 JSON'
      });
      return;
    }

    const profile = recommender.normalizeProfile(payload.profile || payload);
    if (!profile) {
      sendJson(res, 400, { code: 400, message: '请填写有效的年龄、身高与体重' });
      return;
    }

    let menu;
    try {
      menu = readMenu();
    } catch (e) {
      sendJson(res, 500, { code: 500, message: '读取菜单失败' });
      return;
    }

    const plan = recommender.recommend(menu, profile, {
      vegetarian: payload.vegetarian,
      budget: payload.budget
    });
    if (!plan) {
      log.warn('recommend.empty', { goal: profile.goal, vegetarian: Boolean(payload.vegetarian) });
      sendJson(res, 409, { code: 409, message: '当前菜单里没有可推荐的组合（可能都已估清）' });
      return;
    }

    log.info('recommend', {
      profile: {
        gender: profile.gender,
        age: profile.age,
        height: profile.height,
        weight: profile.weight,
        activity: profile.activity,
        goal: profile.goal,
        bmr: profile.bmr,
        tdee: profile.tdee,
        targetCalorie: profile.targetCalorie,
        proteinTarget: profile.proteinTarget
      },
      mealTarget: plan.meal.targetCalorie,
      mealProteinTarget: plan.meal.targetProtein,
      candidates: plan.stats ? plan.stats.evaluated : 0,
      elapsedMs: plan.stats ? plan.stats.elapsedMs : 0,
      picked: plan.items.map((i) => i.id),
      totals: plan.totals,
      match: plan.match,
      budgetRelaxed: plan.budgetRelaxed,
      vegetarian: plan.vegetarian
    });

    if (payload.useAI) {
      const aiStart = Date.now();
      const aiReason = await recommender.enhanceReason(plan.reason, process.env);
      if (aiReason) plan.aiReason = aiReason;
      log.info('recommend.ai', { ok: Boolean(aiReason), ms: Date.now() - aiStart });
    }

    sendJson(res, 200, { code: 0, data: plan });
    return;
  }

  // 一句话点餐：自然语言 → 结构化条件 → 菜单筛选
  if (req.method === 'POST' && url.startsWith('/api/nl-order')) {
    let payload;
    try {
      payload = JSON.parse(await readBody(req, 8 * 1024));
    } catch (e) {
      sendJson(res, 400, { code: 400, message: '请求体不是合法 JSON' });
      return;
    }

    const text = asStr(payload.text, 200);
    if (!text) {
      sendJson(res, 400, { code: 400, message: '请说一句话，例如「500 千卡以内、高蛋白、不要香菜」' });
      return;
    }

    let menu;
    try {
      menu = readMenu();
    } catch (e) {
      sendJson(res, 500, { code: 500, message: '读取菜单失败' });
      return;
    }

    const startedAt = Date.now();
    const llm = await intent.parseWithLLM(text, process.env);
    let conditions = llm;
    let source = llm ? 'llm' : 'none';

    if (!llm || intent.isEmpty(llm)) {
      const fb = intent.fallbackParse(text);
      if (!intent.isEmpty(fb)) {
        conditions = fb;
        source = llm ? 'llm+fallback' : 'fallback';
      } else if (!llm) {
        conditions = Object.assign({}, intent.EMPTY, { excludeKeywords: [], keywords: [] });
      }
    }

    const result = intent.searchWithLoose(menu, conditions, 8);
    const dishes = result.dishes;
    const tags = intent.explain(conditions);

    log.info('intent.parse', {
      source,
      text,
      conditions,
      matched: dishes.length,
      dropped: result.dropped,
      ms: Date.now() - startedAt
    });

    sendJson(res, 200, {
      code: 0,
      data: { source, conditions, tags, dishes, dropped: result.dropped }
    });
    return;
  }

  // 修改单个商品的图片 / 价格 / 库存 / 热量 / 名称 / 描述
  if (req.method === 'PUT' && url.startsWith('/api/dishes/')) {
    if (!requireAuth(req, res)) return;
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
    if (!requireAuth(req, res)) return;
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
      events: [{ status: 'pending', at: now }],
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
      log.error('order.write', { message: e.message });
      sendJson(res, 500, { code: 500, message: '下单失败，请重试' });
      return;
    }

    // 下单成功：记录金额、热量与扣减结果，便于对账和排查
    log.info('order.create', {
      id: order.id,
      items: order.items.length,
      qty: order.itemCount,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      packFee: order.packFee,
      total: order.total,
      calorie: order.totalCalorie,
      dishes: order.items.map((i) => i.dishId)
    });

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
        events: order.events,
        createdAt: order.createdAt
      }
    });
    return;
  }

  // 订单列表（后台用，按创建时间倒序，需登录）
  if (req.method === 'GET' && (url === '/api/orders' || url.startsWith('/api/orders?'))) {
    if (!requireAuth(req, res)) return;
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

  // 单个订单（顾客端跟踪用，凭订单号查询，手机号脱敏）
  if (req.method === 'GET' && url.startsWith('/api/orders/')) {
    const id = decodeURIComponent(url.slice('/api/orders/'.length).split('?')[0]);
    const order = readOrders().find((o) => o.id === id);
    if (!order) {
      sendJson(res, 404, { code: 404, message: '订单不存在' });
      return;
    }
    sendJson(res, 200, {
      code: 0,
      data: {
        id: order.id,
        status: order.status,
        items: (order.items || []).map((i) => ({
          name: i.name,
          specDesc: i.specDesc,
          qty: i.qty,
          amount: i.amount
        })),
        address: {
          name: (order.address && order.address.name) || '',
          phone: maskPhone(order.address && order.address.phone),
          building: (order.address && order.address.building) || '',
          room: (order.address && order.address.room) || ''
        },
        remark: order.remark,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        packFee: order.packFee,
        total: order.total,
        totalCalorie: order.totalCalorie,
        itemCount: order.itemCount,
        events: order.events || [],
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      }
    });
    return;
  }

  // 订单状态流转：接单 / 完成 / 取消
  if (req.method === 'PUT' && url.startsWith('/api/orders/')) {
    if (!requireAuth(req, res)) return;
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
      const from = order.status;
      order.status = next;
      order.updatedAt = new Date().toISOString();
      order.events = Array.isArray(order.events) ? order.events : [{ status: 'pending', at: order.createdAt || order.updatedAt }];
      order.events.push({ status: next, at: order.updatedAt });
      writeOrders(orders);
      log.info('order.status', { id, from, to: next });
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
  process.stdout.write(`后台账号 ${ADMIN_USER}${ADMIN_PASSWORD === 'dika2026' ? '（默认口令，建议用 ADMIN_PASSWORD 覆盖）' : ''}\n`);
  log.info('server.start', { port: PORT, adminUser: ADMIN_USER, logFile: log.file });
});
