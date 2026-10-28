import { api, Dish, MenuData, SpecOption } from '../../services/api';
import { cartStore } from '../../store/cart';
import { fenToYuan } from '../../utils/format';

interface DishVM {
  id: string;
  name: string;
  desc: string;
  emoji: string;
  priceText: string;
  calorie: number;
  soldOut: boolean;
  hasSpecs: boolean;
}

interface GroupVM {
  id: string;
  name: string;
  dishes: DishVM[];
}

interface SkuOptionVM {
  id: string;
  name: string;
  checked: boolean;
}

interface SkuGroupVM {
  id: string;
  name: string;
  required: boolean;
  options: SkuOptionVM[];
}

// 模块级状态：不放进 data，避免每帧都参与 setData 序列化
let menu: MenuData | null = null;
let skuDish: Dish | null = null;
let skuSelected: Record<string, string> = {};

Page({
  data: {
    categories: [] as { id: string; name: string }[],
    groups: [] as GroupVM[],
    activeCat: '',
    anchor: '',
    loading: true,
    error: '',
    cartCount: 0,
    cartAmountText: '0.00',
    cartCalorie: 0,
    skuVisible: false,
    skuName: '',
    skuEmoji: '🥗',
    skuPriceText: '0.00',
    skuGroups: [] as SkuGroupVM[],
    skuQty: 1
  },

  onLoad() {
    void this.loadMenu();
  },

  onShow() {
    this.syncCart();
  },

  async loadMenu() {
    this.setData({ loading: true, error: '' });
    try {
      const data = await api.menu();
      menu = data;
      const groups: GroupVM[] = data.categories
        .map((cat) => ({
          id: cat.id,
          name: cat.name,
          dishes: data.dishes
            .filter((d) => d.cat === cat.id)
            .map((d) => ({
              id: d.id,
              name: d.name,
              desc: d.desc,
              emoji: d.emoji || '🥗',
              priceText: fenToYuan(d.price),
              calorie: d.calorie,
              soldOut: d.stock <= 0,
              hasSpecs: Array.isArray(d.specs) && d.specs.length > 0
            }))
        }))
        .filter((g) => g.dishes.length > 0);

      this.setData({
        categories: data.categories,
        groups,
        activeCat: data.categories.length ? data.categories[0].id : '',
        loading: false
      });
    } catch (err) {
      this.setData({ loading: false, error: (err as Error).message });
    }
  },

  onRetry() {
    void this.loadMenu();
  },

  onCategoryTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    this.setData({ activeCat: id, anchor: 'sec-' + id });
  },

  syncCart() {
    const total = cartStore.total();
    this.setData({
      cartCount: total.count,
      cartAmountText: fenToYuan(total.amount),
      cartCalorie: total.calorie
    });
  },

  onAddTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const dish = menu ? menu.dishes.find((d) => d.id === id) : undefined;
    if (!dish) return;
    if (dish.stock <= 0) {
      wx.showToast({ title: '已估清', icon: 'none' });
      return;
    }
    if (dish.specs && dish.specs.length) {
      this.openSku(dish);
      return;
    }
    cartStore.add(
      {
        dishId: dish.id,
        name: dish.name,
        specDesc: '',
        unitPrice: dish.price,
        qty: 1,
        calorie: dish.calorie
      },
      dish.id + '::'
    );
    this.syncCart();
    wx.vibrateShort({ type: 'light' });
  },

  /* ---------- 规格弹层 ---------- */

  buildSkuGroups(dish: Dish): SkuGroupVM[] {
    return (dish.specs || []).map((g) => ({
      id: g.id,
      name: g.name,
      required: g.required,
      options: g.options.map((o) => ({
        id: o.id,
        name: o.name,
        checked: skuSelected[g.id] === o.id
      }))
    }));
  },

  skuUnitPrice(dish: Dish): number {
    let price = dish.price;
    (dish.specs || []).forEach((g) => {
      const picked = g.options.find((o) => o.id === skuSelected[g.id]);
      if (picked) price += picked.deltaPrice;
    });
    return price;
  },

  openSku(dish: Dish) {
    skuDish = dish;
    skuSelected = {};
    // 默认选中每组第一项：必选项永远有值，价格即时可见
    (dish.specs || []).forEach((g) => {
      if (g.options.length) skuSelected[g.id] = g.options[0].id;
    });
    this.setData({
      skuVisible: true,
      skuName: dish.name,
      skuEmoji: dish.emoji || '🥗',
      skuQty: 1,
      skuGroups: this.buildSkuGroups(dish),
      skuPriceText: fenToYuan(this.skuUnitPrice(dish))
    });
  },

  onSkuTap(e: WechatMiniprogram.TouchEvent) {
    const gid = e.currentTarget.dataset.gid as string;
    const oid = e.currentTarget.dataset.oid as string;
    if (!skuDish) return;
    skuSelected[gid] = oid;
    this.setData({
      skuGroups: this.buildSkuGroups(skuDish),
      skuPriceText: fenToYuan(this.skuUnitPrice(skuDish))
    });
  },

  onQtyMinus() {
    if (this.data.skuQty > 1) this.setData({ skuQty: this.data.skuQty - 1 });
  },

  onQtyPlus() {
    if (this.data.skuQty < 99) this.setData({ skuQty: this.data.skuQty + 1 });
  },

  onSkuConfirm() {
    if (!skuDish) return;
    const dish = skuDish;
    const picked = (dish.specs || [])
      .map((g) => g.options.find((o) => o.id === skuSelected[g.id]))
      .filter((o): o is SpecOption => Boolean(o));
    const specDesc = picked.map((o) => o.name).join(' / ');
    const key = dish.id + '::' + picked.map((o) => o.id).sort().join(',');
    cartStore.add(
      {
        dishId: dish.id,
        name: dish.name,
        specDesc,
        unitPrice: this.skuUnitPrice(dish),
        qty: this.data.skuQty,
        calorie: dish.calorie
      },
      key
    );
    skuDish = null;
    this.setData({ skuVisible: false });
    this.syncCart();
    wx.vibrateShort({ type: 'light' });
  },

  closeSku() {
    skuDish = null;
    this.setData({ skuVisible: false });
  },

  goConfirm() {
    if (cartStore.total().count === 0) return;
    wx.navigateTo({ url: '/pages/confirm/index' });
  },

  goPlan() {
    wx.navigateTo({ url: '/pages/plan/index' });
  }
});
