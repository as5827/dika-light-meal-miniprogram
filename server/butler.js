/**
 * 健康小管家：把「真实订单」变成可解释的饮食记忆，并主动给建议。
 *
 * 设计要点：
 * 1. 记忆来自订单与用户档案，不靠打卡，也不需要额外录入。
 * 2. 所有结论都能回溯到数字：说「蛋白差一截」必须给出具体克数。
 * 3. 只做规则计算，模型最多帮忙润色措辞，不参与判断。
 * 4. 建议可以直接变成购物车里的菜，不产出一份看完就忘的静态计划。
 */

const fs = require('fs');
const path = require('path');
const recommender = require('./recommender');

const ROOT = path.resolve(__dirname, '..');
const USERS_FILE = path.join(ROOT, 'data', 'butler.json');

/* ---------------- 用户档案：只有这一处持久化 ---------------- */

const readUsers = () => {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
};

const writeUsers = (data) => {
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, USERS_FILE);
};

const cleanPhone = (v) => String(v || '').replace(/\D/g, '').slice(0, 11);

const getUser = (phone) => {
  const all = readUsers();
  return all[cleanPhone(phone)] || null;
};

const saveUser = (phone, patch) => {
  const key = cleanPhone(phone);
  if (!key) return null;
  const all = readUsers();
  const now = new Date().toISOString();
  const cur = all[key] || { createdAt: now };
  all[key] = Object.assign({}, cur, patch, { updatedAt: now });
  writeUsers(all);
  return all[key];
};

/* ---------------- 目标：能算就算，算不了用保守默认值 ---------------- */

const FALLBACK_TARGET = {
  cut: { calorie: 520, protein: 32 },
  keep: { calorie: 650, protein: 26 },
  bulk: { calorie: 740, protein: 40 }
};

const resolveTarget = (user) => {
  const goal = (user && user.goal) || 'cut';
  if (user && user.height && user.weight) {
    const p = recommender.normalizeProfile({
      gender: user.gender || 'female',
      age: user.age || 25,
      height: user.height,
      weight: user.weight,
      activity: user.activity || 'light',
      goal
    });
    if (p) {
      return {
        source: 'profile',
        goal,
        goalLabel: goalName(goal),
        calorie: Math.round(p.targetCalorie * 0.4),
        protein: Math.round(p.proteinTarget * 0.4),
        bmr: p.bmr,
        tdee: p.tdee
      };
    }
  }
  const f = FALLBACK_TARGET[goal] || FALLBACK_TARGET.cut;
  return { source: 'default', goal, goalLabel: goalName(goal), calorie: f.calorie, protein: f.protein };
};

const goalName = (g) => ({ cut: '减脂', keep: '维持', bulk: '增肌' }[g] || '减脂');

/* ---------------- 从订单里读出营养与口味 ---------------- */

const dishIndex = (menu) => {
  const map = new Map();
  (menu.dishes || []).forEach((d) => map.set(d.id, d));
  return map;
};

const isVeg = (dish) =>
  Boolean(dish) && (/沙拉|时蔬|蔬菜|西兰花|菠菜|生菜|芦笋/.test(dish.name || ''));

const summarize = (orders, menu, user) => {
  const idx = dishIndex(menu);
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const mine = (orders || []).filter((o) => {
    const p = cleanPhone(o.address && o.address.phone);
    return p && p === cleanPhone(user.phone) && o.status !== 'canceled';
  });

  const week = mine.filter((o) => now - new Date(o.createdAt).getTime() <= 7 * day);

  const dishCount = new Map();
  let calorie = 0;
  let protein = 0;
  let qty = 0;
  let vegHits = 0;

  const eat = (list) => {
    list.forEach((o) => {
      (o.items || []).forEach((it) => {
        const d = idx.get(it.dishId) || {};
        const n = Number(it.qty) || 1;
        calorie += (Number(d.calorie) || 0) * n;
        protein += (Number(d.protein) || 0) * n;
        qty += n;
        if (isVeg(d)) vegHits += n;
        dishCount.set(it.name, (dishCount.get(it.name) || 0) + n);
      });
    });
  };
  eat(week);

  const ranked = Array.from(dishCount.entries()).sort((a, b) => b[1] - a[1]);
  const top = ranked[0] ? { name: ranked[0][0], times: ranked[0][1] } : null;

  const days = new Set(week.map((o) => String(o.createdAt).slice(0, 10))).size || 1;
  // 目标（热量/蛋白）是「每餐」口径，所以均值也必须按每餐算，
  // 否则一天点 3 单会被误判成热量超标 3 倍。
  const meals = week.length || 1;
  const lastAt = mine.length
    ? mine.reduce((m, o) => (String(o.createdAt) > m ? String(o.createdAt) : m), '')
    : null;

  return {
    phone: cleanPhone(user.phone),
    name: (mine[0] && mine[0].address && mine[0].address.name) || (user && user.name) || '',
    totalOrders: mine.length,
    weekOrders: week.length,
    weekDays: week.length ? days : 0,
    weekQty: qty,
    weekCalorie: Math.round(calorie),
    weekProtein: Math.round(protein),
    avgCalorie: week.length ? Math.round(calorie / meals) : 0,
    avgProtein: week.length ? Math.round(protein / meals) : 0,
    perDayCalorie: week.length ? Math.round(calorie / Math.max(days, 1)) : 0,
    perDayProtein: week.length ? Math.round(protein / Math.max(days, 1)) : 0,
    vegRatio: qty ? Math.round((vegHits / qty) * 100) : 0,
    top,
    lastAt,
    daysSinceLast: lastAt ? Math.floor((now - new Date(lastAt).getTime()) / day) : null
  };
};

/* ---------------- 主动建议：每条都能追到数字 ---------------- */

const buildInsights = (sum, target, user) => {
  const list = [];
  const t = target;

  if (sum.totalOrders === 0) {
    list.push({
      id: 'newbie',
      level: 'info',
      icon: 'seed',
      title: '先让我认识你',
      detail: `告诉我身高体重和目标，我就能按你自己的数据算每餐该吃多少。现在先按${t.goalLabel}的通用值算（${t.calorie} kcal / 蛋白 ${t.protein} g）。`,
      action: 'openProfile'
    });
    return list;
  }

  if (sum.daysSinceLast !== null && sum.daysSinceLast >= 7) {
    list.push({
      id: 'comeback',
      level: 'info',
      icon: 'hello',
      title: `${sum.daysSinceLast} 天没见你了`,
      detail: `上次点的是${sum.top ? sum.top.name : '你常点的那份'}。这段时间没记录，正好重新开始。`,
      action: 'recommend'
    });
  }

  if (sum.weekOrders > 0 && sum.avgProtein < t.protein * 0.75) {
    list.push({
      id: 'protein_gap',
      level: 'warn',
      icon: 'protein',
      title: '这几天的蛋白差一截',
      detail: `近 7 天平均每天约 ${sum.avgProtein} g，你的单餐目标是 ${t.protein} g。缺口大概是一份额外的鸡胸肉。`,
      action: 'addProtein'
    });
  }

  if (sum.top && sum.top.times >= 3) {
    list.push({
      id: 'repeat',
      level: 'notice',
      icon: 'repeat',
      title: '有点重样了',
      detail: `近 7 天你点了 ${sum.top.times} 次「${sum.top.name}」。换一份同类不同做法的，营养够也不会腻。`,
      action: 'recommendAlt'
    });
  }

  if (sum.weekOrders > 0 && sum.vegRatio < 20) {
    list.push({
      id: 'veg_gap',
      level: 'warn',
      icon: 'leaf',
      title: '绿叶菜太少了',
      detail: `近 7 天蔬菜类只占 ${sum.vegRatio}%。加一份沙拉或时蔬汤，纤维和饱腹感都会好很多。`,
      action: 'addVeg'
    });
  }

  if (sum.weekOrders > 0 && sum.avgCalorie > t.calorie * 1.25) {
    list.push({
      id: 'calorie_over',
      level: 'notice',
      icon: 'meter',
      title: '热量比目标高一些',
      detail: `近 7 天平均每餐约 ${sum.avgCalorie} kcal，目标是 ${t.calorie} kcal。想吃饱可以挑热量低、体积大的那几款。`,
      action: 'recommendLight'
    });
  }

  if (sum.weekDays >= 3) {
    list.push({
      id: 'streak',
      level: 'good',
      icon: 'star',
      title: `连续 ${sum.weekDays} 天有记录`,
      detail: `这周已经点了 ${sum.weekQty} 份，平均每餐 ${sum.avgCalorie} kcal、蛋白 ${sum.avgProtein} g。保持住比偶尔吃一顿好的更有用。`,
      action: null
    });
  }

  if ((user && user.dislikes && user.dislikes.length) && sum.weekOrders > 0) {
    list.push({
      id: 'memory',
      level: 'good',
      icon: 'book',
      title: '我记得你的忌口',
      detail: `推荐时会避开：${user.dislikes.join('、')}。想改就跟我说「我不吃某某」。`,
      action: null
    });
  }

  return list;
};

/* ---------------- 组装档案 ---------------- */

const buildProfile = ({ orders, menu, phone }) => {
  const user = getUser(phone) || { phone: cleanPhone(phone), goal: 'cut' };
  const target = resolveTarget(user);
  const sum = summarize(orders, menu, { phone, ...user });
  const insights = buildInsights(sum, target, user);

  return {
    identity: {
      phone: sum.phone ? sum.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : '',
      name: sum.name || '',
      goal: target.goal,
      goalLabel: target.goalLabel,
      dislikes: (user.dislikes || []).slice(),
      hasProfile: Boolean(user.height && user.weight),
      firstSeen: user.createdAt || null
    },
    target,
    memory: sum,
    insights,
    greeting: greeting(sum, target)
  };
};

function greeting(sum, target) {
  const h = new Date().getHours();
  const when = h < 10 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
  const who = sum.name ? sum.name + '，' : '';
  if (sum.totalOrders === 0) return `${when}${who}我是你的健康小管家，先点一份试试？`;
  if (sum.daysSinceLast !== null && sum.daysSinceLast >= 7) return `${when}${who}${sum.daysSinceLast} 天没见了，要不要接着上次的口味来？`;
  return `${when}${who}这是你在这家店的第 ${sum.totalOrders} 单，我记着你的口味。`;
}

/* ---------------- 对话：规则优先，答不上再兜底 ---------------- */

const FOOD_WORDS = ['香菜', '葱', '姜', '蒜', '辣', '花生', '牛奶', '芒果', '虾', '牛', '鸡', '鱼', '蛋', '芝士', '洋葱', '芹菜'];

const pickDish = (menu, user, filter) => {
  const dislikes = (user && user.dislikes) || [];
  return (menu.dishes || []).filter((d) =>
    d.stock > 0 &&
    !dislikes.some((x) => (d.name + (d.desc || '')).includes(x)) &&
    (!filter || filter(d))
  );
};

const suggestItems = (dishes, limit) =>
  dishes.slice(0, limit || 2).map((d) => ({
    id: d.id,
    name: d.name,
    price: d.price,
    calorie: d.calorie,
    protein: d.protein
  }));

async function chat({ text, orders, menu, phone }) {
  const user = getUser(phone) || { phone: cleanPhone(phone), goal: 'cut' };
  const target = resolveTarget(user);
  const sum = summarize(orders, menu, { phone, ...user });
  const t = String(text || '').trim();
  const said = t.slice(0, 120);

  if (!t) {
    return { reply: '想聊点什么？可以问我「今天吃什么」「我这周吃得怎么样」。', next: [] };
  }

  // 1. 记忌口
  if (/(不吃|不要|忌口|过敏|讨厌)/.test(t)) {
    const hit = FOOD_WORDS.filter((w) => t.includes(w));
    if (hit.length) {
      const list = Array.from(new Set([...(user.dislikes || []), ...hit]));
      saveUser(phone, { dislikes: list });
      return {
        reply: `记下了，以后推荐会避开${hit.join('、')}。现在你的忌口是：${list.join('、')}。`,
        memoryUpdated: true,
        next: ['今天吃什么', '我的档案']
      };
    }
    return { reply: '想让我避开什么？直接说「我不吃香菜」这种就行。', next: [] };
  }

  // 2. 改目标
  const goalHit = /(增肌|减脂|减肥|维持)/.exec(t);
  if (goalHit && /(改成|换成|我要|想)/.test(t)) {
    const g = /增肌/.test(goalHit[0]) ? 'bulk' : /维持/.test(goalHit[0]) ? 'keep' : 'cut';
    saveUser(phone, { goal: g });
    const nt = resolveTarget(Object.assign({}, user, { goal: g }));
    return {
      reply: `目标已改成${nt.goalLabel}，每餐按 ${nt.calorie} kcal、蛋白 ${nt.protein} g 来控制。`,
      memoryUpdated: true,
      next: ['今天吃什么', '我这周吃得怎么样']
    };
  }

  // 3. 复盘
  if (/(这周|最近|复盘|怎么样|吃得|数据|统计)/.test(t)) {
    if (sum.totalOrders === 0) {
      return { reply: '还没有点餐记录，点一单之后我就能帮你复盘了。', next: ['今天吃什么'] };
    }
    const gap = sum.avgProtein - target.protein;
    return {
      reply:
        `近 7 天你点了 ${sum.weekOrders} 单、${sum.weekQty} 份，平均每餐 ${sum.avgCalorie} kcal、蛋白 ${sum.avgProtein} g` +
        `（目标 ${target.calorie} kcal / ${target.protein} g，蛋白${gap >= 0 ? `超出 ${gap}` : `还差 ${-gap}`} g）；` +
        `平均每天 ${sum.perDayCalorie} kcal。` +
        (sum.top ? `点得最多的是「${sum.top.name}」，${sum.top.times} 次。` : '') +
        (sum.vegRatio < 20 ? '蔬菜比例偏低，可以加一份沙拉。' : '蔬菜比例还行。'),
      next: ['今天吃什么', '我不吃香菜']
    };
  }

  // 4. 我的档案
  if (/(档案|我是谁|记忆|记住|资料)/.test(t)) {
    const d = (user.dislikes || []).join('、') || '还没设置';
    return {
      reply:
        `我记得的：目标${target.goalLabel}，忌口${d}，累计 ${sum.totalOrders} 单` +
        (sum.top ? `，最常点「${sum.top.name}」` : '') +
        (user.height ? `，身高 ${user.height}cm、体重 ${user.weight}kg。` : '，还没填身高体重，填了能算得更准。'),
      next: ['今天吃什么', '我要增肌']
    };
  }

  // 5. 推荐
  if (/(吃什么|推荐|搭配|来点|今天)/.test(t)) {
    const pool = pickDish(menu);
    if (!pool.length) return { reply: '菜单现在都估清了，晚点再来看看。', next: [] };
    const profile = recommender.normalizeProfile({
      gender: user.gender || 'female',
      age: user.age || 25,
      height: user.height || 165,
      weight: user.weight || 58,
      activity: user.activity || 'light',
      goal: target.goal
    });
    const filtered = Object.assign({}, menu, { dishes: pool });
    const plan = recommender.recommend(filtered, profile, {});
    if (!plan) return { reply: '这个组合没算出来，换个要求试试。', next: [] };
    return {
      reply:
        `按你${target.goalLabel}的目标，我配了这组：${plan.items.map((i) => i.name).join(' + ')}，` +
        `合计 ${plan.totals.calorie} kcal、蛋白 ${plan.totals.protein} g、¥${(plan.totals.price / 100).toFixed(0)}。` +
        (user.dislikes && user.dislikes.length ? `已避开${user.dislikes.join('、')}。` : ''),
      suggestion: { title: '一键加入购物车', items: plan.items.map((i) => ({ id: i.id, name: i.name, price: i.price, calorie: i.calorie })) },
      next: ['换一组', '我这周吃得怎么样']
    };
  }

  // 6. 兜底
  return {
    reply: `我是点餐时顺手用的健康小管家，能帮你：按你的记录复盘、避开忌口挑菜、把一整餐配好直接加进购物车。刚才那句「${said}」我没太懂，试试下面的说法？`,
    next: ['今天吃什么', '我这周吃得怎么样', '我不吃香菜']
  };
}

module.exports = {
  readUsers,
  writeUsers,
  getUser,
  saveUser,
  cleanPhone,
  buildProfile,
  chat,
  resolveTarget,
  goalName
};
