import { api, PlanResult, RecommendOption, RecommendOptions } from '../../services/api';
import { cartStore } from '../../store/cart';
import { fenToYuan } from '../../utils/format';

interface PlanItemVM {
  name: string;
  meta: string;
  priceText: string;
}

interface MetricVM {
  k: string;
  v: string;
}

interface ResultVM {
  metrics: MetricVM[];
  items: PlanItemVM[];
  totalLine: string;
  matchLine: string;
  matchGood: boolean;
  warn: string;
  reason: string;
}

let options: RecommendOptions | null = null;
let lastResult: PlanResult | null = null;

Page({
  data: {
    ready: false,
    error: '',
    genders: [] as RecommendOption[],
    activities: [] as RecommendOption[],
    goals: [] as RecommendOption[],
    activityIndex: 0,
    goalIndex: 0,
    gender: 'female',
    age: '26',
    height: '165',
    weight: '58',
    vegetarian: false,
    budget: '',
    submitting: false,
    result: null as ResultVM | null
  },

  onLoad() {
    void this.init();
  },

  async init() {
    try {
      if (!options) options = await api.recommendOptions();
      this.setData({
        ready: true,
        genders: options.genders,
        activities: options.activities,
        goals: options.goals
      });
    } catch (err) {
      this.setData({ error: (err as Error).message });
    }
  },

  onGender(e: WechatMiniprogram.TouchEvent) {
    this.setData({ gender: e.currentTarget.dataset.value as string });
  },

  onInput(e: WechatMiniprogram.Input) {
    const field = e.currentTarget.dataset.field as string;
    this.setData({ [field]: e.detail.value } as WechatMiniprogram.IAnyObject);
  },

  onActivityChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ activityIndex: Number(e.detail.value) });
  },

  onGoalChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ goalIndex: Number(e.detail.value) });
  },

  onVeg(e: WechatMiniprogram.SwitchChange) {
    this.setData({ vegetarian: Boolean(e.detail.value) });
  },

  async onSubmit() {
    if (this.data.submitting || !options) return;
    const activity = options.activities[this.data.activityIndex];
    const goal = options.goals[this.data.goalIndex];
    const budget = this.data.budget ? Math.round(Number(this.data.budget) * 100) : 0;

    this.setData({ submitting: true });
    try {
      const data = await api.recommend({
        profile: {
          gender: this.data.gender,
          age: Number(this.data.age),
          height: Number(this.data.height),
          weight: Number(this.data.weight),
          activity: activity ? activity.value : 'light',
          goal: goal ? goal.value : 'cut'
        },
        vegetarian: this.data.vegetarian,
        budget: Number.isFinite(budget) ? budget : 0
      });
      lastResult = data;
      this.setData({ result: this.buildVM(data), submitting: false });
    } catch (err) {
      this.setData({ submitting: false });
      wx.showToast({ title: (err as Error).message || '推荐失败', icon: 'none', duration: 2500 });
    }
  },

  buildVM(data: PlanResult): ResultVM {
    const diff = data.match.calorieDiffPct;
    return {
      metrics: [
        { k: '基础代谢', v: data.profile.bmr + ' kcal' },
        { k: '日常消耗', v: data.profile.tdee + ' kcal' },
        { k: '每日目标', v: data.profile.targetCalorie + ' kcal' },
        { k: '蛋白目标', v: data.profile.proteinTarget + ' g' },
        { k: '本餐预算', v: data.meal.targetCalorie + ' kcal' },
        { k: '蛋白预算', v: data.meal.targetProtein + ' g' }
      ],
      items: data.items.map((i) => ({
        name: i.name,
        meta: i.calorie + ' kcal · 蛋白 ' + i.protein + ' g',
        priceText: '¥' + fenToYuan(i.price)
      })),
      totalLine:
        '合计 ' + data.totals.calorie + ' kcal · 蛋白 ' + data.totals.protein + ' g · ¥' + fenToYuan(data.totals.price),
      matchLine:
        '热量偏差 ' + (diff > 0 ? '+' : '') + diff + '% · 蛋白达成 ' + data.match.proteinPct + '%',
      matchGood: Math.abs(diff) <= 10,
      warn: data.budgetRelaxed ? '预算内没有合适组合，已自动放宽' : '',
      reason: data.aiReason || data.reason
    };
  },

  onAgain() {
    this.setData({ result: null });
  },

  onAddCart() {
    if (!lastResult) return;
    lastResult.items.forEach((i) => {
      cartStore.add(
        {
          dishId: i.id,
          name: i.name,
          specDesc: '',
          unitPrice: i.price,
          qty: 1,
          calorie: i.calorie
        },
        i.id + '::'
      );
    });
    wx.showToast({ title: '套餐已加入购物车', icon: 'none' });
    wx.navigateBack();
  }
});
