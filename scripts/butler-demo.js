// 健康小管家冒烟测试：造数据 → 看档案 → 聊三轮
const http = require('http');

const BASE = 'http://127.0.0.1:3000';
const PHONE = '13800001111';

const req = (method, path, body) => new Promise((resolve, reject) => {
  const u = new URL(BASE + path);
  const data = body ? JSON.stringify(body) : null;
  const r = http.request({
    hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
    headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
  }, (res) => {
    let buf = '';
    res.on('data', (c) => (buf += c));
    res.on('end', () => {
      let json = null;
      try { json = JSON.parse(buf); } catch (_) {}
      resolve({ status: res.statusCode, json, raw: buf });
    });
  });
  r.on('error', reject);
  if (data) r.write(data);
  r.end();
});

(async () => {
  const menu = (await req('GET', '/api/menu')).json.data;
  const dishes = menu.dishes.filter((d) => d.stock > 0);
  console.log('可售菜品:', dishes.length);

  // 造 6 单，全部落在这一个手机号上（模拟老顾客）
  const picks = [];
  for (let i = 0; i < 6; i++) {
    const d = dishes[(i * 5) % dishes.length];
    const res = await req('POST', '/api/orders', {
      items: [{ dishId: d.id, qty: 1 + (i % 2), unitPrice: d.price }],
      address: { name: '李同学', phone: PHONE, building: '3号楼', room: '302' },
      remark: ''
    });
    if (res.json && res.json.code === 0) picks.push(d.name);
  }
  console.log('已造单:', picks.length, picks.join(' / '));

  const prof = await req('GET', '/api/butler/profile?phone=' + PHONE);
  if (!prof.json || prof.json.code !== 0) {
    console.log('档案失败:', prof.status, prof.raw.slice(0, 200));
    return;
  }
  const p = prof.json.data;
  console.log('\n=== 问候 ===');
  console.log(' ', p.greeting);
  console.log('=== 记忆 ===');
  console.log('  累计单数', p.memory.totalOrders, '| 近7天', p.memory.weekOrders,
    '| 日均', p.memory.avgCalorie, 'kcal /', p.memory.avgProtein, 'g 蛋白',
    '| 蔬菜占比', p.memory.vegRatio + '%', '| 最爱', p.memory.top && p.memory.top.name);
  console.log('  目标', p.target.goalLabel, p.target.calorie, 'kcal /', p.target.protein, 'g', '(', p.target.source, ')');
  console.log('=== 主动建议 ===');
  p.insights.forEach((i) => console.log(`  [${i.level}] ${i.title} — ${i.detail}`));

  console.log('\n=== 对话 ===');
  for (const text of ['今天吃什么', '我不吃香菜', '我这周吃得怎么样']) {
    const res = await req('POST', '/api/butler/chat', { phone: PHONE, text });
    const d = res.json && res.json.data;
    console.log(`\n  我：${text}`);
    console.log(`  管家：${d ? d.reply : 'ERR ' + res.status}`);
    if (d && d.suggestion) console.log(`         [+ ${d.suggestion.items.map((x) => x.name).join('、')}]`);
  }

  console.log('\n=== 忌口是否被记住 ===');
  const after = (await req('GET', '/api/butler/profile?phone=' + PHONE)).json.data;
  console.log('  dislikes =', JSON.stringify(after.identity.dislikes));
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
