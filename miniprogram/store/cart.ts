export interface CartItem {
  key: string;
  dishId: string;
  name: string;
  specDesc: string;
  unitPrice: number;
  qty: number;
  calorie: number;
}

export interface CartTotal {
  count: number;
  amount: number;
  calorie: number;
}

/**
 * 购物车：模块级单例，页面间共享（小程序同一运行环境下模块只求值一次）。
 * 刻意不引入 mobx / miniprogram 状态库——本项目的状态只有「一车商品」，
 * 用不到 observable 那一套；页面在 onShow 时主动 syncCart() 即可。
 */
let items: CartItem[] = [];

export const cartStore = {
  list(): CartItem[] {
    return items;
  },

  add(item: Omit<CartItem, 'key'>, key: string): void {
    const exist = items.find((i) => i.key === key);
    if (exist) {
      exist.qty += item.qty;
      return;
    }
    items.push({ ...item, key });
  },

  total(): CartTotal {
    return items.reduce<CartTotal>(
      (acc, i) => ({
        count: acc.count + i.qty,
        amount: acc.amount + i.qty * i.unitPrice,
        calorie: acc.calorie + i.qty * i.calorie
      }),
      { count: 0, amount: 0, calorie: 0 }
    );
  },

  clear(): void {
    items = [];
  }
};
