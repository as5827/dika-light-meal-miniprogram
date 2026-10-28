/**
 * 个性化减脂套餐推荐引擎
 *
 * 设计原则：
 * 1. 确定性 —— 同样的输入永远得到同样的输出，便于复现与评审（不依赖随机数、不依赖模型采样）
 * 2. 零依赖 —— 只用营养素公式与组合搜索，不引第三方库
 * 3. 可解释 —— 每个数字都能在结果里被拆解（BMR / TDEE / 目标热量 / 蛋白目标 / 偏差）
 *
 * 计算链路：
 *   身体指标 → Mifflin-St Jeor 基础代谢(BMR) → 活动系数得 TDEE
 *   → 目标系数得每日目标热量与蛋白目标 → 取 40% 作为单餐预算
 *   → 在「主菜 + 加料 + 汤/果汁 + 甜点」的组合空间里搜索
 *   → 目标函数：蛋白达成度↑、热量偏差↓、价格↓
 *
 * 说明：菜单里的 protein 为估算值（见 data/menu.json 的 nutritionNote），
 * 推荐结果仅用于产品演示，不构成营养学建议。
 */

const ACTIVITY = {
  sedentary: { label: '久坐、几乎不运动', factor: 1.2 },
  light: { label: '轻度活动（每周 1-3 次）', factor: 1.375 },
  moderate: { label: '中度活动（每周 3-5 次）', factor: 1.55 },
  active: { label: '高强度（每周 6-7 次）', factor: 1.725 }
};

const GOAL = {
  cut: { label: '减脂', calorieFactor: 0.8, proteinPerKg: 1.6, minCalorie: 1200 },
  keep: { label: '维持', calorieFactor: 1, proteinPerKg: 1.2, minCalorie: 1400 },
  gain: { label: '增肌', calorieFactor: 1.1, proteinPerKg: 1.8, minCalorie: 1600 }
};

const MEAL_RATIO = 0.4;
const MAIN_CATS = ['c1', 'c2', 'c3', 'c4'];

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function options() {
  return {
    genders: [
      { value: 'female', label: '女' },
      { value: 'male', label: '男' }
    ],
    activities: Object.keys(ACTIVITY).map((k) => ({ value: k, label: ACTIVITY[k].label })),
    goals: Object.keys(GOAL).map((k) => ({ value: k, label: GOAL[k].label })),
    mealRatio: MEAL_RATIO
  };
}

function normalizeProfile(input) {
  const raw = input || {};
  const gender = raw.gender === 'female' ? 'female' : 'male';
  const age = clampNumber(raw.age, 14, 80);
  const height = clampNumber(raw.height, 140, 210);
  const weight = clampNumber(raw.weight, 35, 150);
  if (age === null || height === null || weight === null) return null;

  const activity = ACTIVITY[raw.activity] ? raw.activity : 'light';
  const goal = GOAL[raw.goal] ? raw.goal : 'cut';
  const cfg = GOAL[goal];

  // Mifflin-St Jeor
  const bmr = Math.round(10 * weight + 6.25 * height - 5 * age + (gender === 'male' ? 5 : -161));
  const tdee = Math.round(bmr * ACTIVITY[activity].factor);
  const targetCalorie = Math.max(cfg.minCalorie, Math.round(tdee * cfg.calorieFactor));
  const proteinTarget = Math.round(weight * cfg.proteinPerKg);

  return {
    gender,
    age,
    height,
    weight,
    activity,
    goal,
    bmr,
    tdee,
    targetCalorie,
    proteinTarget
  };
}

function totalsOf(items) {
  return items.reduce(
    (acc, d) => ({
      calorie: acc.calorie + (d.calorie || 0),
      protein: acc.protein + (d.protein || 0),
      price: acc.price + (d.price || 0)
    }),
    { calorie: 0, protein: 0, price: 0 }
  );
}

function buildReason(profile, meal, totals, match, flags) {
  const cfg = GOAL[profile.goal];
  return [
    `按你的指标，基础代谢约 ${profile.bmr} kcal，日常消耗约 ${profile.tdee} kcal；` +
      `${cfg.label}期建议每日摄入 ${profile.targetCalorie} kcal、蛋白质约 ${profile.proteinTarget} g。`,
    `本餐按全天的 ${Math.round(MEAL_RATIO * 100)}% 计，预算 ${meal.targetCalorie} kcal / ${meal.targetProtein} g 蛋白。`,
    `这套组合合计 ${totals.calorie} kcal、蛋白 ${totals.protein} g，` +
      `热量偏差 ${match.calorieDiffPct > 0 ? '+' : ''}${match.calorieDiffPct}%，蛋白达成 ${match.proteinPct}%。`,
    flags.vegetarian ? '已在素菜范围内筛选。' : '',
    flags.budgetRelaxed ? '预算内没有合适组合，已自动放宽预算。' : ''
  ]
    .filter(Boolean)
    .join('');
}

function recommend(menu, profile, prefs) {
  const optionsIn = prefs || {};
  const budget = clampNumber(optionsIn.budget, 0, 200000) || 0;
  const vegetarian = Boolean(optionsIn.vegetarian);

  const mealCalorie = Math.round(profile.targetCalorie * MEAL_RATIO);
  const mealProtein = Math.round(profile.proteinTarget * MEAL_RATIO);

  const pool = (menu.dishes || []).filter((d) => {
    if (!(d.stock > 0)) return false;
    if (vegetarian && !(d.tags || []).includes('素食')) return false;
    return true;
  });

  const mains = pool.filter((d) => MAIN_CATS.includes(d.cat));
  if (!mains.length) return null;

  const sides = pool.filter((d) => d.cat === 'c8');
  const soups = pool.filter((d) => d.cat === 'c5' || d.cat === 'c6');
  const desserts = pool.filter((d) => d.cat === 'c7');

  function search(relaxBudget) {
    let best = null;
    let cheapest = null;
    const consider = (items) => {
      const totals = totalsOf(items);
      if (budget && !relaxBudget && totals.price > budget) return;
      if (totals.calorie > mealCalorie * 1.35) return;

      const caloriePenalty = Math.abs(totals.calorie - mealCalorie) / mealCalorie;
      const proteinScore = Math.min(1.6, totals.protein / Math.max(mealProtein, 1));
      // 蛋白质超过目标的 1.3 倍后开始扣分：避免"堆鸡胸"式的极端组合
      const overProtein = Math.max(0, totals.protein - mealProtein * 1.3) / Math.max(mealProtein, 1);
      const priceScore = budget
        ? relaxBudget
          ? Math.min(1, 2000 / Math.max(totals.price, 800))
          : Math.max(0, 1 - totals.price / budget)
        : Math.min(1, 4000 / Math.max(totals.price, 800));

      const score = proteinScore * 0.5 - caloriePenalty * 0.35 - overProtein * 0.2 + priceScore * 0.15;
      if (!best || score > best.score) {
        best = { items, totals, score };
      }

      // 预算内无解时，退而求其次：在满足营养下限的组合里挑最便宜的
      const proteinOk = totals.protein >= mealProtein * 0.6;
      const calorieOk = totals.calorie >= mealCalorie * 0.7;
      if (proteinOk && calorieOk && (!cheapest || totals.price < cheapest.totals.price)) {
        cheapest = { items, totals, score };
      }
    };

    for (const main of mains) {
      for (const side of [null].concat(sides)) {
        for (const soup of [null].concat(soups)) {
          for (const dessert of [null].concat(desserts)) {
            consider([main, side, soup, dessert].filter(Boolean));
          }
        }
      }
    }
    return relaxBudget && cheapest ? cheapest : best;
  }

  let best = search(false);
  let budgetRelaxed = false;
  if (!best && budget) {
    best = search(true);
    budgetRelaxed = Boolean(best);
  }
  if (!best) return null;

  const match = {
    calorieDiffPct: Math.round(((best.totals.calorie - mealCalorie) / mealCalorie) * 100),
    proteinPct: Math.round((best.totals.protein / Math.max(mealProtein, 1)) * 100)
  };

  return {
    profile,
    meal: { targetCalorie: mealCalorie, targetProtein: mealProtein, ratio: MEAL_RATIO },
    items: best.items.map((d) => ({
      id: d.id,
      name: d.name,
      cat: d.cat,
      calorie: d.calorie,
      protein: d.protein,
      price: d.price
    })),
    totals: best.totals,
    match,
    budgetRelaxed,
    vegetarian,
    reason: buildReason(profile, { targetCalorie: mealCalorie, targetProtein: mealProtein }, best.totals, match, {
      vegetarian,
      budgetRelaxed
    })
  };
}

/**
 * 可选的大模型文案增强：配置了 LLM_API_KEY 才会调用，失败自动回落模板文案。
 * 约束：只允许改写语气，不允许改变任何数字（避免模型幻觉污染营养数据）。
 */
async function enhanceReason(facts, env) {
  const key = env && env.LLM_API_KEY;
  if (!key) return null;

  const base = (env.LLM_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const model = env.LLM_MODEL || 'deepseek-chat';

  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        max_tokens: 260,
        messages: [
          {
            role: 'system',
            content:
              '你是一位耐心、鼓励型的营养师。你只能改写语气，不得修改、新增、删除任何数字或结论；' +
              '输出 120 字以内中文，不要分点。'
          },
          { role: 'user', content: '事实：' + facts + '\n请用更口语、鼓励的语气重写。' }
        ]
      }),
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) return null;
    const json = await res.json();
    const text = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    return typeof text === 'string' && text.trim() ? text.trim().slice(0, 300) : null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  ACTIVITY,
  GOAL,
  options,
  normalizeProfile,
  recommend,
  enhanceReason
};
