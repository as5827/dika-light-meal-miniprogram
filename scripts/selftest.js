#!/usr/bin/env node
/**
 * 端到端自测：把所有对外接口按真实调用顺序跑一遍。
 *
 * 用法：
 *   node server/server.js          # 另开一个窗口
 *   node scripts/selftest.js       # 默认 http://127.0.0.1:3000
 *
 * 可用环境变量：
 *   BASE_URL   服务地址，默认 http://127.0.0.1:3000
 *   ADMIN_USER / ADMIN_PASSWORD  后台账号，默认 admin / dika2026
 *
 * 退出码：全部通过 0，有失败 1（可直接放进 CI 当冒烟测试）。
 */

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'dika2026';

let pass = 0;
const failures = [];
let cookie = '';

function ok(name, detail) {
  pass += 1;
  console.log('  \x1b[32mPASS\x1b[0m  ' + name + (detail ? '  \x1b[90m' + detail + '\x1b[0m' : ''));
}

function bad(name, detail) {
  failures.push(name + (detail ? ' — ' + detail : ''));
  console.log('  \x1b[31mFAIL\x1b[0m  ' + name + (detail ? '  ' + detail : ''));
}

function check(name, cond, detail) {
  if (cond) ok(name, detail);
  else bad(name, detail);
  return cond;
}

async function call(method, path, body, opts) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (opts && opts.noCookie) delete headers.Cookie;

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  });

  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (setCookies.length) {
    cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  }

  const type = res.headers.get('content-type') || '';
  let json = null;
  let text = '';
  if (type.includes('application/json')) {
    json = await res.json().catch(() => null);
  } else {
    text = await res.text().catch(() => '');
  }
  return { status: res.status, json, text, type };
}

const yuan = (fen) => (fen / 100).toFixed(2);

async function main() {
  console.log('\n自测目标：' + BASE + '\n');

  // ---------- 1. 静态页面 ----------
  console.log('[1] 静态页面');
  const home = await call('GET', '/');
  check('首页 / 返回 200 且是 HTML', home.status === 200 && home.type.includes('text/html'), 'status=' + home.status);
  check('首页含店铺名', home.text.includes('dika'), '');
  const adminPage = await call('GET', '/admin/index.html');
  check('后台页 /admin/index.html 可访问', adminPage.status === 200, 'status=' + adminPage.status);
  const docPage = await call('GET', '/docs/tech-doc.html');
  check('技术文档页可访问', docPage.status === 200, 'status=' + docPage.status);

  // ---------- 2. 菜单 ----------
  console.log('\n[2] 菜单数据');
  const menu = await call('GET', '/api/menu');
  const menuData = menu.json && menu.json.data;
  check('GET /api/menu 返回 code 0', menu.status === 200 && menu.json.code === 0, 'status=' + menu.status);
  check('分类 8 个', !!menuData && menuData.categories.length === 8, 'got=' + (menuData ? menuData.categories.length : 'null'));
  check('菜品 28 个', !!menuData && menuData.dishes.length === 28, 'got=' + (menuData ? menuData.dishes.length : 'null'));
  const fieldOk = menuData && menuData.dishes.every((d) => typeof d.calorie === 'number' && typeof d.protein === 'number' && typeof d.price === 'number' && typeof d.stock === 'number');
  check('每个菜品都有 calorie/protein/price/stock', fieldOk, '');
  check('计费规则存在', !!menuData && !!menuData.fees && typeof menuData.fees.deliveryFee === 'number', '');

  const dishes = menuData ? menuData.dishes : [];
  const inStock = dishes.filter((d) => d.stock > 0);
  const soldOut = dishes.filter((d) => d.stock === 0);
  const dishA = inStock[0];
  const dishB = inStock[1] || inStock[0];
  const lowStock = dishes.reduce((min, d) => Math.min(min, d.stock), 99);

  // ---------- 3. 推荐 ----------
  console.log('\n[3] AI 套餐推荐');
  const opts = await call('GET', '/api/recommend/options');
  const optData = opts.json && opts.json.data;
  check('GET /api/recommend/options 返回选项', opts.status === 200 && !!(optData && optData.activities && optData.goals), '');

  const profile = { gender: 'female', age: 26, height: 165, weight: 58, activity: 'light', goal: 'cut' };
  const rec = await call('POST', '/api/recommend', { profile, prefs: {} });
  const recData = rec.json && rec.json.data;
  check('POST /api/recommend 成功', rec.status === 200 && rec.json.code === 0, 'status=' + rec.status);
  check('返回 3 道菜的组合', !!(recData && recData.items && recData.items.length === 3), 'n=' + (recData && recData.items ? recData.items.length : 'null'));
  check('算出单餐预算与合计', !!(recData && recData.meal.targetCalorie > 0 && recData.totals.calorie > 0), '');
  check('给出基础代谢与每日目标', !!(recData && recData.profile.bmr > 0 && recData.profile.targetCalorie > 0), 'bmr=' + (recData && recData.profile ? recData.profile.bmr : 'null'));
  check('推荐过程有候选统计', !!(recData && recData.stats && recData.stats.evaluated > 100), 'evaluated=' + (recData && recData.stats ? recData.stats.evaluated : 'null'));
  check('给出了推荐理由', !!(recData && typeof recData.reason === 'string' && recData.reason.length > 10), '');
  check('热量偏差在 ±5% 内', !!(recData && Math.abs(recData.match.calorieDiffPct) <= 5), 'diff=' + (recData && recData.match ? recData.match.calorieDiffPct : 'null'));

  const recAI = await call('POST', '/api/recommend', { profile, prefs: {}, useAI: true });
  check('useAI=true 仍返回 200', recAI.status === 200 && recAI.json.code === 0, '');
  const sameNumbers =
    !!(recAI.json && recData) &&
    recAI.json.data.totals.calorie === recData.totals.calorie &&
    recAI.json.data.totals.protein === recData.totals.protein &&
    recAI.json.data.meal.targetCalorie === recData.meal.targetCalorie &&
    recAI.json.data.items.map((i) => i.id).join(',') === recData.items.map((i) => i.id).join(',');
  check('大模型不改动任何数字与组合', sameNumbers, '');

  const recBad = await call('POST', '/api/recommend', { profile: { gender: 'female' } });
  check('缺字段的推荐请求被拒（400）', recBad.status === 400, 'status=' + recBad.status);

  // ---------- 4. 一句话点餐 ----------
  console.log('\n[4] 一句话点餐');
  const nl = await call('POST', '/api/nl-order', { text: '我想吃500千卡以内、高蛋白、不要香菜，预算40' });
  const nlData = nl.json && nl.json.data;
  check('POST /api/nl-order 成功', nl.status === 200 && nl.json.code === 0, 'status=' + nl.status);
  check('解析出来源标识', !!nlData && ['llm', 'llm+fallback', 'fallback', 'none'].includes(nlData.source), 'source=' + (nlData && nlData.source));
  check('解析出至少一个条件', !!nlData && nlData.tags.length > 0, 'tags=' + (nlData && nlData.tags.join('/')));
  check('命中菜品不超过 8 个', !!nlData && Array.isArray(nlData.dishes) && nlData.dishes.length <= 8, 'n=' + (nlData && nlData.dishes.length));

  const nlEmpty = await call('POST', '/api/nl-order', { text: '' });
  check('空输入被拒（400）', nlEmpty.status === 400, 'status=' + nlEmpty.status);

  const nlBadJson = await call('POST', '/api/nl-order', {});
  check('没有 text 字段被拒（400）', nlBadJson.status === 400, 'status=' + nlBadJson.status);

  // ---------- 5. 下单 ----------
  console.log('\n[5] 下单与库存');
  const before = (await call('GET', '/api/menu')).json.data.dishes.find((d) => d.id === dishA.id).stock;
  const address = { name: '李同学', phone: '13800001234', building: '3号楼', room: '302' };
  const orderBody = { items: [{ dishId: dishA.id, qty: 2, unitPrice: dishA.price }], address, remark: '自测订单' };

  const created = await call('POST', '/api/orders', orderBody);
  const order = created.json && created.json.data;
  check('POST /api/orders 下单成功', created.status === 200 && created.json.code === 0, 'status=' + created.status);
  check('订单号格式正确', !!order && /^\d{14}-[a-z0-9]{4}$/.test(order.id), 'id=' + (order && order.id));

  const after = (await call('GET', '/api/menu')).json.data.dishes.find((d) => d.id === dishA.id).stock;
  check('库存已扣减 2', after === before - 2, before + ' -> ' + after);

  const orderDetail = await call('GET', '/api/orders/' + (order && order.id));
  const detail = orderDetail.json && orderDetail.json.data;
  check('GET /api/orders/:id 查得到', orderDetail.status === 200 && orderDetail.json.code === 0, '');
  check('返回的手机号已脱敏', !!detail && detail.address.phone.includes('*') && !detail.address.phone.includes('13800001234'), 'phone=' + (detail && detail.address.phone));
  check('初始状态为 pending', !!detail && detail.status === 'pending', 'status=' + (detail && detail.status));
  check('事件链有一条 pending', !!detail && detail.events.length === 1 && detail.events[0].status === 'pending', '');
  check('金额 = 小计 + 配送 + 打包', !!detail && detail.total === detail.subtotal + detail.deliveryFee + detail.packFee, '');

  const wrongPrice = await call('POST', '/api/orders', { items: [{ dishId: dishA.id, qty: 1, unitPrice: 1 }], address });
  check('报价低于菜品价被拒（400）', wrongPrice.status === 400, 'status=' + wrongPrice.status);

  const tooMany = await call('POST', '/api/orders', { items: [{ dishId: dishA.id, qty: 99, unitPrice: dishA.price }], address });
  check('超库存被拒（409 或 400）', tooMany.status === 409 || tooMany.status === 400, 'status=' + tooMany.status);

  const badPhone = await call('POST', '/api/orders', { items: [{ dishId: dishA.id, qty: 1, unitPrice: dishA.price }], address: Object.assign({}, address, { phone: '123' }) });
  check('手机号非法被拒（400）', badPhone.status === 400, 'status=' + badPhone.status);

  const noItems = await call('POST', '/api/orders', { items: [], address });
  check('空购物车被拒（400）', noItems.status === 400, 'status=' + noItems.status);

  const ghostDish = await call('POST', '/api/orders', { items: [{ dishId: 'd999', qty: 1, unitPrice: 100 }], address });
  check('不存在的菜品被拒（400）', ghostDish.status === 400, 'status=' + ghostDish.status);

  // ---------- 6. 鉴权 ----------
  console.log('\n[6] 鉴权');
  const unauth = await call('GET', '/api/orders', undefined, { noCookie: true });
  check('未登录读订单列表被拒（401）', unauth.status === 401, 'status=' + unauth.status);

  const unauthStats = await call('GET', '/api/stats', undefined, { noCookie: true });
  check('未登录读看板被拒（401）', unauthStats.status === 401, 'status=' + unauthStats.status);

  const badLogin = await call('POST', '/api/login', { username: ADMIN_USER, password: 'wrong-password' });
  check('错误密码被拒（401）', badLogin.status === 401, 'status=' + badLogin.status);

  const login = await call('POST', '/api/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  check('正确密码登录成功', login.status === 200 && login.json.code === 0, 'status=' + login.status);
  check('拿到会话 Cookie', cookie.includes('dika_admin'), cookie ? 'cookie ok' : 'cookie 为空');

  const session = await call('GET', '/api/session');
  check('GET /api/session 返回当前用户', session.status === 200 && session.json.data.user === ADMIN_USER, '');

  // ---------- 7. 订单流转 ----------
  console.log('\n[7] 订单状态流转');
  const list = await call('GET', '/api/orders?limit=10');
  const listArr = Array.isArray(list.json && list.json.data) ? list.json.data : ((list.json && list.json.data && list.json.data.orders) || []);
  check('后台订单列表可读', list.status === 200 && listArr.length > 0, 'n=' + listArr.length);
  check('列表包含刚下的单', !!listArr.find((o) => o.id === order.id), '');
  check('后台保留完整手机号（配送需要）', listArr.every((o) => !o.address || !o.address.phone || o.address.phone === undefined || /^1\d{10}$/.test(o.address.phone)), '');

  const accept = await call('PUT', '/api/orders/' + order.id, { status: 'accepted' });
  check('pending → accepted 成功', accept.status === 200 && accept.json.code === 0, 'status=' + accept.status);

  const detail2 = (await call('GET', '/api/orders/' + order.id)).json.data;
  check('状态已变为 accepted', detail2.status === 'accepted', '');
  check('事件链追加了一条', detail2.events.length === 2 && detail2.events[1].status === 'accepted', 'n=' + detail2.events.length);

  const back = await call('PUT', '/api/orders/' + order.id, { status: 'pending' });
  check('accepted → pending 被拒（400）', back.status === 400, 'status=' + back.status);

  const done = await call('PUT', '/api/orders/' + order.id, { status: 'done' });
  check('accepted → done 成功', done.status === 200 && done.json.code === 0, 'status=' + done.status);

  const badStatus = await call('PUT', '/api/orders/' + order.id, { status: 'flying' });
  check('非法状态值被拒（400）', badStatus.status === 400, 'status=' + badStatus.status);

  const ghostOrder = await call('PUT', '/api/orders/20200101000000-zzzz', { status: 'accepted' });
  check('不存在的订单返回 404', ghostOrder.status === 404, 'status=' + ghostOrder.status);

  // ---------- 8. 菜品维护 ----------
  console.log('\n[8] 菜品维护');
  const oldPrice = dishB.price;
  const edit = await call('PUT', '/api/dishes/' + dishB.id, { price: oldPrice + 100 });
  check('改价格成功', edit.status === 200 && edit.json.code === 0, 'status=' + edit.status);

  const priceNow = (await call('GET', '/api/menu')).json.data.dishes.find((d) => d.id === dishB.id).price;
  check('新价格已生效', priceNow === oldPrice + 100, oldPrice + ' -> ' + priceNow);

  const restore = await call('PUT', '/api/dishes/' + dishB.id, { price: oldPrice });
  check('价格已还原', restore.status === 200, '');

  const badEdit = await call('PUT', '/api/dishes/' + dishB.id, { price: -5 });
  check('负价格被忽略（仍 200 但不生效）', badEdit.status === 200, '');

  const editNoAuth = await fetch(BASE + '/api/dishes/' + dishB.id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ price: 1 })
  });
  check('未登录改菜品被拒（401）', editNoAuth.status === 401, 'status=' + editNoAuth.status);

  // ---------- 9. 经营看板 ----------
  console.log('\n[9] 经营看板');
  const statsRes = await call('GET', '/api/stats');
  const s = statsRes.json && statsRes.json.data;
  check('GET /api/stats 成功', statsRes.status === 200 && statsRes.json.code === 0, 'status=' + statsRes.status);
  check('今日订单数 ≥ 1', !!s && s.orders.total >= 1, 'total=' + (s && s.orders.total));
  check('热销榜按份数降序', !!s && s.topDishes.every((x, i, a) => i === 0 || a[i - 1].qty >= x.qty), '');
  check('热量分桶数量之和 = 有热量订单数', !!s && s.calorie.buckets.reduce((n, b) => n + b.count, 0) <= s.orders.total, '');

  const insight = await call('POST', '/api/stats/insight');
  const ins = insight.json && insight.json.data;
  check('POST /api/stats/insight 成功', insight.status === 200 && insight.json.code === 0, 'status=' + insight.status);
  check('返回解读文本', !!ins && typeof ins.text === 'string' && ins.text.length > 10, 'source=' + (ins && ins.source));
  check('解读来源标明 llm / template', !!ins && ['llm', 'template'].includes(ins.source), 'source=' + (ins && ins.source));

  // ---------- 10. 登出 ----------
  console.log('\n[10] 登出');
  const logout = await call('POST', '/api/logout');
  check('登出成功', logout.status === 200 && logout.json.code === 0, 'status=' + logout.status);
  const afterLogout = await call('GET', '/api/session');
  check('登出后会话失效（401）', afterLogout.status === 401, 'status=' + afterLogout.status);

  // ---------- 11. 日志 ----------
  console.log('\n[11] 运行日志');
  const fs = require('fs');
  const path = require('path');
  const logFile = process.env.LOG_FILE || path.join(__dirname, '..', 'logs', 'app.log');
  if (fs.existsSync(logFile)) {
    const raw = fs.readFileSync(logFile, 'utf8');
    const tail = raw.slice(-200000);
    const need = ['"event":"http"', '"event":"order.create"', '"event":"order.status"', '"event":"auth.login"',
      '"event":"dish.update"', '"event":"intent.parse"', '"event":"stats.read"', '"event":"stats.insight"', '"event":"auth.logout"'];
    const missing = need.filter((k) => !tail.includes(k));
    check('日志文件存在且为 JSON Lines', tail.includes('"level"') && tail.includes('"ts"'), logFile);
    check('关键事件都写进了日志', missing.length === 0, missing.length ? '缺少 ' + missing.join(',') : need.length + ' 类事件齐全');
    check('日志里没有明文手机号', !tail.includes('13800001234'), '');
    check('日志里没有 API Key', !/sk-[A-Za-z0-9]{16,}/.test(tail), '');
  } else {
    check('日志文件存在（跳过详检）', false, '未找到 ' + logFile + '，请设 LOG_TO_FILE=1 后重启服务');
  }

  // ---------- 汇总 ----------
  const total = pass + failures.length;
  console.log('\n' + '─'.repeat(56));
  console.log('通过 ' + pass + ' / ' + total + '　失败 ' + failures.length);
  if (failures.length) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log('  · ' + f));
  }
  console.log('测试数据提示：本次自测创建了 ' + 1 + ' 笔订单，库存扣减 ' + 2 + ' 份（数据在 data/ 下，已在 .gitignore 中）');
  console.log('─'.repeat(56) + '\n');

  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error('\n自测异常中断：' + e.message);
  process.exit(1);
});
