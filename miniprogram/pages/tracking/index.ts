import { api, OrderDetail, OrderEvent } from '../../services/api';
import { POLL_INTERVAL } from '../../services/config';
import { clock, fenToYuan } from '../../utils/format';

const STEPS = ['已提交', '已接单', '制作中', '已完成'];
const STEP_INDEX: Record<string, number> = { pending: 1, accepted: 2, done: 3, canceled: -1 };
const STATUS_TEXT: Record<string, string> = {
  pending: '等待商家接单',
  accepted: '商家已接单，正在制作',
  done: '订单已完成',
  canceled: '订单已取消'
};
const EVENT_TEXT: Record<string, string> = {
  pending: '订单已提交，等待商家接单',
  accepted: '商家已接单，开始制作',
  done: '餐品制作完成，请取餐',
  canceled: '订单已取消'
};

interface StepVM {
  label: string;
  seq: number;
  state: string;
}

interface EventVM {
  time: string;
  text: string;
  latest: boolean;
}

let orderId = '';
let timer: number | null = null;

Page({
  data: {
    loading: true,
    error: '',
    statusText: '订单加载中',
    subText: '',
    steps: [] as StepVM[],
    events: [] as EventVM[],
    totalText: '0.00',
    itemCount: 0,
    calorie: 0,
    canceled: false
  },

  onLoad(options: Record<string, string | undefined>) {
    orderId = options.id || '';
    if (!orderId) {
      this.setData({ loading: false, error: '缺少订单号' });
      return;
    }
    void this.refresh(true).then(() => this.startPolling());
  },

  onShow() {
    if (orderId && timer === null) {
      void this.refresh(false);
      this.startPolling();
    }
  },

  onHide() {
    this.stopPolling();
  },

  onUnload() {
    this.stopPolling();
  },

  async refresh(initial: boolean) {
    try {
      const order = await api.order(orderId);
      this.render(order);
      if (order.status === 'done' || order.status === 'canceled') this.stopPolling();
    } catch (err) {
      if (initial) this.setData({ loading: false, error: (err as Error).message });
    }
  },

  render(order: OrderDetail) {
    const step = STEP_INDEX[order.status] === undefined ? 0 : STEP_INDEX[order.status];
    this.setData({
      loading: false,
      error: '',
      canceled: order.status === 'canceled',
      statusText: STATUS_TEXT[order.status] || '订单处理中',
      subText: '订单号 ' + order.id,
      steps: STEPS.map((label, i) => ({
        label,
        seq: i + 1,
        state: step < 0 ? 'todo' : i < step ? 'done' : i === step ? 'current' : 'todo'
      })),
      events: (order.events || [])
        .slice()
        .reverse()
        .map((ev: OrderEvent, idx: number) => ({
          time: clock(ev.at),
          text: EVENT_TEXT[ev.status] || ev.status,
          latest: idx === 0
        })),
      totalText: fenToYuan(order.total),
      itemCount: order.itemCount,
      calorie: order.totalCalorie
    });
  },

  startPolling() {
    this.stopPolling();
    timer = setInterval(() => {
      void this.refresh(false);
    }, POLL_INTERVAL) as unknown as number;
  },

  stopPolling() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  },

  goMenu() {
    wx.reLaunch({ url: '/pages/menu/index' });
  }
});
