#!/usr/bin/env node
/**
 * 造演示数据：录视频或截图前跑一遍，让后台看板、订单列表、跟踪页都有内容。
 *
 *   node scripts/seed-demo.js           # 默认造 8 单
 *   node scripts/seed-demo.js 15        # 造 15 单
 *
 * 只会新增订单并扣对应库存，不会删数据；想重来就删掉 data/orders.json 再把库存改回去
 * （或直接 git checkout data/menu.json，菜单恢复初始库存）。
 */

const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = Number(process.env.PORT) || 3000;
const BASE = process.env.BASE_URL || 'http://127.0.0.1:' + PORT;
const COUNT = Number(process.argv[2]) || 8;

function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(BASE + pathname);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode, body: buf }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(pathname) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + pathname);
    http
      .get({ hostname: url.hostname, port: url.port, path: url.pathname }, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode, body: buf }));
      })
      .on('error', reject);
  });
}

const NAMES = ['李同学', '王同学', '张同学', '赵同学', '陈同学', '周同学', '吴同学', '郑同学'];
// 固定一位「老顾客」：点餐搭档靠同一个手机号认人，演示时要能看到记忆与主动建议
const ME = { name: '王同学', phone: '13800002222' };
const BUILDINGS = ['1号楼', '3号楼', '5号楼', '图书馆', '实验楼'];

async function main() {
  const menu = JSON.parse((await get('/api/menu')).body).data;
  const dishes = menu.dishes.filter((d) => d.stock > 0);
  if (!dishes.length) {
    console.error('菜单里没有可售菜品，先补库存再跑');
    process.exit(1);
  }

  let ok = 0;
  for (let i = 0; i < COUNT; i += 1) {
    const picks = [];
    const n = 1 + (i % 3); // 1~3 个菜
    for (let k = 0; k < n; k += 1) {
      const d = dishes[(i * 7 + k * 3) % dishes.length];
      if (picks.find((p) => p.dishId === d.id)) continue;
      picks.push({ dishId: d.id, qty: 1 + ((i + k) % 2), unitPrice: d.price });
    }
    if (!picks.length) continue;

    const body = {
      items: picks,
      address: i % 3 === 2
        ? {
            name: NAMES[i % NAMES.length],
            phone: '138' + String(10000000 + i * 137).slice(0, 8),
            building: BUILDINGS[i % BUILDINGS.length],
            room: String(101 + i * 7)
          }
        : {
            name: ME.name,
            phone: ME.phone,
            building: BUILDINGS[i % BUILDINGS.length],
            room: String(101 + i * 7)
          },
      remark: i % 4 === 0 ? '不要香菜' : ''
    };

    const res = await post('/api/orders', body);
    if (res.status === 200 && res.body.includes('"code":0')) ok += 1;
    else console.log('  第 ' + (i + 1) + ' 单失败：' + res.body.slice(0, 80));
  }

  // 把刚造的订单撒到最近 7 天里：不然所有订单都是「今天」，点餐搭档的按天回顾与
  // 连续打卡判断会失真，看板的今日数据也会被堆满。
  try {
    const fsx = require('fs');
    const px = require('path');
    const file = px.resolve(__dirname, '..', 'data', 'orders.json');
    if (fsx.existsSync(file)) {
      const list = JSON.parse(fsx.readFileSync(file, 'utf8'));
      const nowMs = Date.now();
      list.forEach((o, i) => {
        const daysAgo = i % 7;
        const at = new Date(nowMs - daysAgo * 24 * 3600 * 1000 - (i % 5) * 9 * 60 * 1000);
        o.createdAt = at.toISOString();
        o.updatedAt = o.createdAt;
      });
      list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      fsx.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
      console.log('已把演示订单撒到最近 7 天');
    }
  } catch (e) {
    console.log('撒日期失败（不影响其它功能）：' + e.message);
  }

  console.log('已创建 ' + ok + ' / ' + COUNT + ' 笔演示订单');
  console.log('提示：后台看板与订单列表刷新即可看到；想恢复库存请 git checkout data/menu.json');
}

main().catch((e) => {
  console.error('造数据失败：' + e.message);
  process.exit(1);
});
