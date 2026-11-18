#!/usr/bin/env node
/**
 * 演示数据：一位减脂顾客连续 7 天的点餐记录。
 *
 * 和 seed-demo.js 的区别：seed-demo 是随机造单，用来把看板填满；
 * 这个脚本写的是**有剧本的**历史——同一个人、偏汤品与甜品、蛋白与蔬菜都偏低、
 * 三天点了同一道主食。跑完之后「点餐搭档」的结论、四条建议、七天柱状图
 * 都是可预期的，录视频时不会出现「怎么什么都没有」。
 *
 *   node scripts/demo-seed.js
 *
 * 合并写入 data/orders.json（只替换该手机号的记录），并写入 data/butler.json 的用户档案。
 * 想恢复成干净状态：删掉 data/orders.json 与 data/butler.json，
 * 再 git checkout -- data/menu.json 还原库存。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MENU = path.join(ROOT, 'data', 'menu.json');
const ORDERS = path.join(ROOT, 'data', 'orders.json');
const BUTLER = path.join(ROOT, 'data', 'butler.json');

const PHONE = '13800001111';
const NAME = '李同学';

// 剧本：daysAgo 表示「几天前」，一天可能下 1 单，每单 1~3 个菜
const SCRIPT = [
  { daysAgo: 6, dishes: ['照烧鸡腿糙米碗', '柠檬薄荷气泡水'] },
  { daysAgo: 5, dishes: ['奶油南瓜浓汤', '抹茶豆腐慕斯', '柠檬薄荷气泡水'] },
  { daysAgo: 4, dishes: ['牛油果贝果', '玉米鸡茸浓汤'] },
  { daysAgo: 3, dishes: ['抹茶豆腐慕斯', '巴西莓抗氧化果昔'] },
  { daysAgo: 2, dishes: ['照烧鸡腿糙米碗', '牛油果半颗'] },
  { daysAgo: 1, dishes: ['番茄时蔬汤', '溏心蛋'] },
  { daysAgo: 0, dishes: ['照烧鸡腿糙米碗', '柠檬薄荷气泡水'] }
];

// 用户档案：有身高体重，目标才会按 BMR 算，而不是用通用值
const PROFILE = {
  name: NAME,
  goal: 'cut',
  gender: 'female',
  age: 26,
  height: 165,
  weight: 58,
  activity: 'light',
  dislikes: []
};

const main = () => {
  const menu = JSON.parse(fs.readFileSync(MENU, 'utf8'));
  const byName = new Map(menu.dishes.map((d) => [d.name, d]));
  const fees = menu.fees || { deliveryFee: 500, packFee: 200, freeDeliveryThreshold: 5800 };

  const missing = [];
  const now = Date.now();
  let orders = [];
  let seq = 0;

  SCRIPT.forEach((plan) => {
    const items = [];
    plan.dishes.forEach((name, k) => {
      const d = byName.get(name);
      if (!d) { missing.push(name); return; }
      const qty = 1;
      items.push({
        dishId: d.id,
        name: d.name,
        specDesc: '',
        unitPrice: d.price,
        qty,
        calorie: d.calorie,
        amount: d.price * qty
      });
      seq += 1;
    });
    if (!items.length) return;

    const subtotal = items.reduce((s, i) => s + i.amount, 0);
    const packFee = fees.packFee || 0;
    const deliveryFee = subtotal >= (fees.freeDeliveryThreshold || 0) ? 0 : (fees.deliveryFee || 0);
    // 今天那单固定在 90 分钟前，避免减掉 11 小时后跨到昨天、让最后一天柱子为 0；
    // 其余几天落在本地 11:20 左右，看起来像正常的外卖午餐
    let at;
    if (plan.daysAgo === 0) {
      at = new Date(now - 90 * 60 * 1000);
    } else {
      at = new Date(now - plan.daysAgo * 24 * 3600 * 1000);
      at.setHours(11, 20 + (seq % 4) * 10, 0, 0);
    }
    const stamp = at.toISOString();

    orders.push({
      id: stamp.replace(/[-:T.Z]/g, '').slice(0, 14) + '-' + String(1000 + seq),
      status: 'done',
      items,
      address: { name: NAME, phone: PHONE, building: '3号楼', room: '302室' },
      remark: '',
      subtotal,
      deliveryFee,
      packFee,
      total: subtotal + packFee + deliveryFee,
      totalCalorie: items.reduce((s, i) => s + (i.calorie || 0) * i.qty, 0),
      createdAt: stamp,
      updatedAt: stamp
    });
  });

  if (missing.length) {
    console.log('菜单里找不到这些菜，已跳过：' + Array.from(new Set(missing)).join('、'));
  }

  // 合并而不是覆盖：保留 seed-demo 造的其他顾客订单，只刷新这个手机号的剧本。
  // 两个脚本可以先后跑，谁先谁后都不会互相抹掉。
  let existing = [];
  if (fs.existsSync(ORDERS)) {
    try {
      existing = JSON.parse(fs.readFileSync(ORDERS, 'utf8'));
    } catch (e) {
      existing = [];
    }
  }
  const others = existing.filter((o) => !(o.address && o.address.phone === PHONE));
  const merged = others.concat(orders);
  merged.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  fs.writeFileSync(ORDERS, JSON.stringify(merged, null, 2), 'utf8');
  orders = merged;

  const users = {};
  const iso = new Date(now).toISOString();
  users[PHONE] = Object.assign({}, PROFILE, { createdAt: iso, updatedAt: iso });
  fs.writeFileSync(BUTLER, JSON.stringify(users, null, 2), 'utf8');
  try { fs.mkdirSync(path.dirname(ORDERS), { recursive: true }); } catch (e) { /* 已存在 */ }

  const totalCal = orders.reduce((s, o) => s + o.totalCalorie, 0);
  console.log('已写入 ' + orders.length + ' 单演示订单（' + NAME + ' / ' + PHONE + '），共 ' + totalCal + ' kcal');
  console.log('已写入用户档案：目标减脂、165cm / 58kg、轻度活动');
  console.log('提示：起服务后打开点餐页，右下角「点餐搭档」即为剧本效果');
};

main();
