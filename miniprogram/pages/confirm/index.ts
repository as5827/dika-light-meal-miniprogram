import { Address, api, Fees, OrderItemInput } from '../../services/api';
import { CartItem, cartStore } from '../../store/cart';
import { fenToYuan } from '../../utils/format';

const ADDR_KEY = 'dika_address';

const DEFAULT_FEES: Fees = { deliveryFee: 500, packFee: 200, freeDeliveryThreshold: 5800 };

interface ItemVM {
  key: string;
  name: string;
  specDesc: string;
  qty: number;
  amountText: string;
}

let fees: Fees = DEFAULT_FEES;

Page({
  data: {
    items: [] as ItemVM[],
    subtotalText: '0.00',
    deliveryText: '¥0.00',
    packText: '¥0.00',
    totalText: '0.00',
    calorie: 0,
    name: '',
    phone: '',
    building: '',
    room: '',
    remark: '',
    submitting: false
  },

  onLoad() {
    const saved = wx.getStorageSync(ADDR_KEY) as Address | '';
    if (saved && saved.name) {
      this.setData({
        name: saved.name,
        phone: saved.phone,
        building: saved.building,
        room: saved.room
      });
    }
    void this.init();
  },

  async init() {
    const list = cartStore.list();
    if (!list.length) {
      wx.showToast({ title: '购物车是空的', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    try {
      const menu = await api.menu();
      fees = menu.fees;
    } catch (e) {
      // 取不到计费规则时用默认值兜底：最终金额仍由服务端重算
      fees = DEFAULT_FEES;
    }
    this.render(list);
  },

  render(list: CartItem[]) {
    const subtotal = list.reduce((s, i) => s + i.qty * i.unitPrice, 0);
    const calorie = list.reduce((s, i) => s + i.qty * i.calorie, 0);
    const delivery = subtotal >= fees.freeDeliveryThreshold ? 0 : fees.deliveryFee;
    const total = subtotal + delivery + fees.packFee;
    this.setData({
      items: list.map((i) => ({
        key: i.key,
        name: i.name,
        specDesc: i.specDesc,
        qty: i.qty,
        amountText: fenToYuan(i.qty * i.unitPrice)
      })),
      subtotalText: fenToYuan(subtotal),
      deliveryText: delivery === 0 ? '免配送费（满 ¥' + fenToYuan(fees.freeDeliveryThreshold) + '）' : '¥' + fenToYuan(delivery),
      packText: '¥' + fenToYuan(fees.packFee),
      totalText: fenToYuan(total),
      calorie
    });
  },

  onInput(e: WechatMiniprogram.Input) {
    const field = e.currentTarget.dataset.field as string;
    this.setData({ [field]: e.detail.value } as WechatMiniprogram.IAnyObject);
  },

  toast(msg: string) {
    wx.showToast({ title: msg, icon: 'none' });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const { name, phone, building, room, remark } = this.data;

    if (!building.trim() || !room.trim()) {
      this.toast('请填写楼栋与门牌号');
      return;
    }
    if (!name.trim()) {
      this.toast('请填写联系人');
      return;
    }
    if (!/^1\d{10}$/.test(phone.trim())) {
      this.toast('请填写 11 位手机号');
      return;
    }

    const address: Address = {
      name: name.trim(),
      phone: phone.trim(),
      building: building.trim(),
      room: room.trim()
    };
    wx.setStorageSync(ADDR_KEY, address);

    const items: OrderItemInput[] = cartStore.list().map((i) => ({
      dishId: i.dishId,
      qty: i.qty,
      unitPrice: i.unitPrice,
      specDesc: i.specDesc
    }));

    this.setData({ submitting: true });
    try {
      const order = await api.createOrder({ items, address, remark: remark.trim() });
      cartStore.clear();
      wx.redirectTo({ url: '/pages/tracking/index?id=' + order.id });
    } catch (err) {
      this.setData({ submitting: false });
      wx.showToast({ title: (err as Error).message || '下单失败', icon: 'none', duration: 2500 });
    }
  }
});
