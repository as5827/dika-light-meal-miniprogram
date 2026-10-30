/**
 * 点餐意图解析：把一句人话变成结构化的筛选条件。
 *
 * 两条路径：
 *   1. 配了大模型 Key → 让模型按固定 JSON 结构输出（temperature 0，失败/超时回落）
 *   2. 没配或调用失败 → 正则兜底（"500千卡以内""不要香菜""预算40"这类说法基本都能中）
 *
 * 设计原则和推荐引擎一致：模型只负责"理解"，筛选与计算全部在本地完成，
 * 所以同一句话+同一份菜单，结果可复现。
 */

const CONDITION_KEYS = ['maxCalorie', 'minProtein', 'maxPrice', 'vegetarian', 'excludeKeywords', 'keywords'];

const EMPTY = {
  maxCalorie: null,
  minProtein: null,
  maxPrice: null,
  vegetarian: false,
  excludeKeywords: [],
  keywords: []
};

const num = (v, min, max) => {
  if (v === null || v === undefined || v === '') return null; // 注意 Number(null) === 0，必须先挡掉
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const strList = (v, limit) =>
  Array.isArray(v)
    ? v
        .filter((x) => typeof x === 'string')
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, limit)
    : [];

/** 把模型/正则给的原始对象收敛成合法结构 */
function normalize(raw) {
  const src = raw || {};
  return {
    maxCalorie: num(src.maxCalorie, 50, 2000),
    minProtein: num(src.minProtein, 0, 80),
    maxPrice: num(src.maxPrice, 1, 500), // 单位：元
    vegetarian: Boolean(src.vegetarian),
    excludeKeywords: strList(src.excludeKeywords, 5),
    keywords: strList(src.keywords, 5)
  };
}

/** 没有任何条件时返回 true，用来判断"这句话没听懂" */
function isEmpty(cond) {
  return (
    cond.maxCalorie === null &&
    cond.minProtein === null &&
    cond.maxPrice === null &&
    !cond.vegetarian &&
    cond.excludeKeywords.length === 0 &&
    cond.keywords.length === 0
  );
}

/** 正则兜底：不依赖模型，覆盖常见说法 */
function fallbackParse(text) {
  const t = String(text || '').slice(0, 200);
  const cond = Object.assign({}, EMPTY, { excludeKeywords: [], keywords: [] });

  const cal = t.match(/(\d{2,4})\s*(千卡|大卡|kcal|卡)/i) || t.match(/热量\D{0,3}(\d{2,4})/);
  if (cal) cond.maxCalorie = num(cal[1], 50, 2000);

  const pro = t.match(/蛋白\D{0,4}(\d{1,3})/) || t.match(/(\d{1,3})\s*(?:g|克)\s*蛋白/i);
  if (pro) cond.minProtein = num(pro[1], 0, 80);

  const price = t.match(/预算\s*(\d{1,3})/) || t.match(/(\d{1,3})\s*元(?:以内|以下)?/) || t.match(/不超过\s*(\d{1,3})/);
  if (price) cond.maxPrice = num(price[1], 1, 500);

  if (/素|不吃肉|全素/.test(t)) cond.vegetarian = true;

  const exclude = t.match(/(?:不要|不吃|忌|别放|少放)\s*([\u4e00-\u9fa5]{1,4})/g) || [];
  cond.excludeKeywords = exclude
    .map((x) => x.replace(/^(?:不要|不吃|忌|别放|少放)\s*/, ''))
    .filter(Boolean)
    .slice(0, 5);

  const KEYWORDS = ['鸡胸', '牛肉', '三文鱼', '虾', '沙拉', '三明治', '牛油果', '果汁', '酸奶', '鱼', '汤', '碗', '卷'];
  cond.keywords = KEYWORDS.filter((k) => t.includes(k)).slice(0, 5);

  return normalize(cond);
}

const SYSTEM_PROMPT = [
  '你是点餐意图解析器。把用户的一句话转换成严格的 JSON，不要输出任何解释。',
  '字段与含义：',
  '{"maxCalorie": 数字或null,  // 热量上限，单位千卡',
  ' "minProtein": 数字或null,  // 蛋白质下限，单位克',
  ' "maxPrice": 数字或null,    // 价格上限，单位元',
  ' "vegetarian": true或false, // 是否只要素食',
  ' "excludeKeywords": [字符串], // 忌口或不要的食材',
  ' "keywords": [字符串]}       // 想吃的关键词（如鸡胸、沙拉、汤）',
  '用户没提到的字段一律填 null / false / []。宁可留空，不要猜。'
].join('\n');

/** 调大模型解析；失败返回 null，由调用方回落正则 */
async function parseWithLLM(text, env) {
  const key = env && env.LLM_API_KEY;
  if (!key) return null;
  const base = (env.LLM_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const model = env.LLM_MODEL || 'deepseek-chat';

  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: String(text).slice(0, 200) }
        ]
      }),
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return null;
    const json = await res.json();
    const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (typeof content !== 'string') return null;
    const parsed = JSON.parse(content.replace(/^```json\s*|```$/g, '').trim());
    return normalize(parsed);
  } catch (e) {
    return null;
  }
}

/** 把条件翻译成人话，前端直接当标签显示 */
function explain(cond) {
  const out = [];
  if (cond.maxCalorie !== null) out.push('热量 ≤ ' + cond.maxCalorie + ' kcal');
  if (cond.minProtein !== null) out.push('蛋白 ≥ ' + cond.minProtein + ' g');
  if (cond.maxPrice !== null) out.push('价格 ≤ ¥' + cond.maxPrice);
  if (cond.vegetarian) out.push('只要素食');
  cond.excludeKeywords.forEach((k) => out.push('不要' + k));
  cond.keywords.forEach((k) => out.push('想吃' + k));
  return out;
}

/** 按条件过滤菜单，返回命中菜品（按蛋白降序、热量升序） */
function applyConditions(menu, cond, limit) {
  const max = limit || 8;
  let list = (menu.dishes || []).filter((d) => d.stock > 0);

  if (cond.vegetarian) list = list.filter((d) => (d.tags || []).includes('素食'));
  if (cond.maxCalorie !== null) list = list.filter((d) => (d.calorie || 0) <= cond.maxCalorie);
  if (cond.minProtein !== null) list = list.filter((d) => (d.protein || 0) >= cond.minProtein);
  if (cond.maxPrice !== null) list = list.filter((d) => d.price <= cond.maxPrice * 100);

  const text = (d) => (d.name || '') + (d.desc || '') + (d.tags || []).join(' ');
  if (cond.excludeKeywords.length) {
    list = list.filter((d) => !cond.excludeKeywords.some((k) => text(d).includes(k)));
  }
  if (cond.keywords.length) {
    list = list.filter((d) => cond.keywords.some((k) => text(d).includes(k)));
  }

  return list
    .sort((a, b) => (b.protein || 0) - (a.protein || 0) || (a.calorie || 0) - (b.calorie || 0))
    .slice(0, max)
    .map((d) => ({
      id: d.id,
      name: d.name,
      desc: d.desc,
      cat: d.cat,
      price: d.price,
      calorie: d.calorie,
      protein: d.protein || 0,
      emoji: d.emoji || '🥗'
    }));
}

/**
 * 带放宽的检索：先按全部条件筛，筛不到就逐个去掉最"软"的条件（关键词→忌口→蛋白→价格→热量→素食），
 * 并返回被去掉的条件，前端可以提示"未完全匹配，已放宽 xxx"。
 */
function searchWithLoose(menu, cond, limit) {
  const dropped = [];
  const cur = {
    maxCalorie: cond.maxCalorie,
    minProtein: cond.minProtein,
    maxPrice: cond.maxPrice,
    vegetarian: cond.vegetarian,
    excludeKeywords: (cond.excludeKeywords || []).slice(),
    keywords: (cond.keywords || []).slice()
  };

  const steps = [
    ['keywords', () => (cur.keywords.length ? '想吃' + cur.keywords.join('/') : null), () => { cur.keywords = []; }],
    ['excludeKeywords', () => (cur.excludeKeywords.length ? '不要' + cur.excludeKeywords.join('/') : null), () => { cur.excludeKeywords = []; }],
    ['minProtein', () => (cur.minProtein !== null ? '蛋白 ≥ ' + cur.minProtein + ' g' : null), () => { cur.minProtein = null; }],
    ['maxPrice', () => (cur.maxPrice !== null ? '价格 ≤ ¥' + cur.maxPrice : null), () => { cur.maxPrice = null; }],
    ['maxCalorie', () => (cur.maxCalorie !== null ? '热量 ≤ ' + cur.maxCalorie + ' kcal' : null), () => { cur.maxCalorie = null; }],
    ['vegetarian', () => (cur.vegetarian ? '只要素食' : null), () => { cur.vegetarian = false; }]
  ];

  let dishes = applyConditions(menu, cur, limit);
  for (const [, label, reset] of steps) {
    if (dishes.length) break;
    const text = label();
    if (!text) continue;
    reset();
    dropped.push(text);
    dishes = applyConditions(menu, cur, limit);
  }

  return { dishes, dropped, effective: cur };
}

module.exports = {
  EMPTY,
  normalize,
  isEmpty,
  fallbackParse,
  parseWithLLM,
  explain,
  applyConditions,
  searchWithLoose,
  SYSTEM_PROMPT
};
