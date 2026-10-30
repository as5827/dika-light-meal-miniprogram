/**
 * 经营看板：把订单聚合成本日概览，并可让大模型写一段人话解读。
 *
 * 与推荐/意图解析同一个原则：数字全部在本地算好，模型只负责把数字说清楚，
 * 不允许新增、修改或推测任何数字。
 */

const BUCKETS = [
  { label: '< 300', min: 0, max: 300 },
  { label: '300–500', min: 300, max: 500 },
  { label: '500–700', min: 500, max: 700 },
  { label: '> 700', min: 700, max: Infinity }
];

const isSameDay = (iso, ref) => {
  const d = new Date(iso);
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
};

/** 聚合今日数据；orders 为 readOrders() 的结果，menu 为当前菜单 */
function compute(orders, menu, ref) {
  const now = ref || new Date();
  const today = (orders || []).filter((o) => o.createdAt && isSameDay(o.createdAt, now));
  const active = today.filter((o) => o.status !== 'canceled');

  const revenue = active.reduce((s, o) => s + (o.total || 0), 0);
  const done = today.filter((o) => o.status === 'done').length;
  const pending = today.filter((o) => o.status === 'pending').length;
  const canceled = today.filter((o) => o.status === 'canceled').length;

  const hours = Array.from({ length: 24 }, (_, h) => ({ h, count: 0 }));
  today.forEach((o) => {
    hours[new Date(o.createdAt).getHours()].count += 1;
  });

  const dishMap = new Map();
  today.forEach((o) => {
    (o.items || []).forEach((i) => {
      const cur = dishMap.get(i.name) || { name: i.name, qty: 0, revenue: 0 };
      cur.qty += i.qty || 0;
      cur.revenue += i.amount || 0;
      dishMap.set(i.name, cur);
    });
  });
  const topDishes = Array.from(dishMap.values())
    .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
    .slice(0, 5);

  const cals = today.map((o) => o.totalCalorie || 0).filter((x) => x > 0);
  const avgCalorie = cals.length ? Math.round(cals.reduce((a, b) => a + b, 0) / cals.length) : 0;
  const calorieBuckets = BUCKETS.map((b) => ({
    label: b.label,
    count: cals.filter((c) => c >= b.min && c < b.max).length
  }));

  const dishes = (menu && menu.dishes) || [];
  const lowStock = dishes.filter((d) => d.stock > 0 && d.stock <= 3);
  const soldOut = dishes.filter((d) => d.stock === 0);

  return {
    date: now.toISOString().slice(0, 10),
    orders: { total: today.length, active: active.length, done, pending, canceled },
    revenue,
    avgTicket: active.length ? Math.round(revenue / active.length) : 0,
    hours,
    topDishes,
    calorie: { avg: avgCalorie, buckets: calorieBuckets },
    inventory: { low: lowStock.length, soldOut: soldOut.length, lowNames: lowStock.map((d) => d.name).slice(0, 3) },
    peakHour: hours.reduce((a, b) => (b.count > a.count ? b : a), hours[0])
  };
}

const SYSTEM_PROMPT = [
  '你是一家轻食店的店长，正在看今天的经营数据。',
  '根据数据写 3 条经营建议，每条不超过 40 字，用「1. 2. 3.」编号。',
  '只依据给出的数字，不要编造数字、不要预测、不要使用感叹号以外的修辞。'
].join('\n');

/** 模板兜底：没有模型时也能给出一段可读的解读 */
function fallbackInsight(s) {
  const money = (v) => '¥' + (v / 100).toFixed(0);
  const top = s.topDishes[0];
  const parts = [];
  parts.push(
    '今日 ' + s.orders.total + ' 单，营业额 ' + money(s.revenue) + '，客单价 ' + money(s.avgTicket) +
      (top ? '，卖得最好的是' + top.name + '（' + top.qty + ' 份）。' : '。')
  );
  if (s.peakHour && s.peakHour.count > 0) {
    parts.push('下单高峰在 ' + s.peakHour.h + ' 点（' + s.peakHour.count + ' 单），可提前备料。');
  }
  if (s.inventory.low || s.inventory.soldOut) {
    parts.push('库存告急 ' + s.inventory.low + ' 项、售罄 ' + s.inventory.soldOut + ' 项，建议优先补货。');
  }
  if (s.calorie.avg) {
    parts.push('客单平均 ' + s.calorie.avg + ' kcal，' + (s.calorie.avg > 600 ? '偏高，可推低卡组合。' : '处于合理区间。'));
  }
  return parts.join('');
}

/** 让模型把数字讲成人话；失败返回 null */
async function insight(env, s) {
  const key = env && env.LLM_API_KEY;
  if (!key) return null;
  const base = (env.LLM_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const model = env.LLM_MODEL || 'deepseek-chat';

  const facts = {
    订单: s.orders,
    营业额_元: Math.round(s.revenue / 100),
    客单价_元: Math.round(s.avgTicket / 100),
    高峰时段: s.peakHour.h + '点',
    热销: s.topDishes.map((d) => d.name + '×' + d.qty),
    客单平均热量: s.calorie.avg,
    库存告急: s.inventory.low,
    售罄: s.inventory.soldOut
  };

  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 260,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: '今日数据：' + JSON.stringify(facts, null, 0) }
        ]
      }),
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
  } catch (e) {
    return null;
  }
}

module.exports = { compute, insight, fallbackInsight, SYSTEM_PROMPT };
