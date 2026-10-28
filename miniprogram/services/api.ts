import { API_BASE } from './config';

export interface Category {
  id: string;
  name: string;
}

export interface SpecOption {
  id: string;
  name: string;
  deltaPrice: number;
}

export interface SpecGroup {
  id: string;
  name: string;
  required: boolean;
  options: SpecOption[];
}

export interface Dish {
  id: string;
  cat: string;
  name: string;
  desc: string;
  price: number;
  calorie: number;
  image: string;
  emoji: string;
  stock: number;
  tags: string[];
  specs?: SpecGroup[];
}

export interface Fees {
  deliveryFee: number;
  packFee: number;
  freeDeliveryThreshold: number;
}

export interface MenuData {
  categories: Category[];
  dishes: Dish[];
  fees: Fees;
}

export interface Address {
  name: string;
  phone: string;
  building: string;
  room: string;
}

export interface OrderItemInput {
  dishId: string;
  qty: number;
  unitPrice: number;
  specDesc?: string;
}

export interface OrderEvent {
  status: string;
  at: string;
}

export interface OrderSummary {
  id: string;
  status: string;
  subtotal: number;
  deliveryFee: number;
  packFee: number;
  total: number;
  totalCalorie: number;
  itemCount: number;
  events: OrderEvent[];
  createdAt: string;
}

export interface OrderItemDetail {
  name: string;
  specDesc: string;
  qty: number;
  amount: number;
}

export interface OrderDetail {
  id: string;
  status: string;
  items: OrderItemDetail[];
  address: Address;
  remark: string;
  subtotal: number;
  deliveryFee: number;
  packFee: number;
  total: number;
  totalCalorie: number;
  itemCount: number;
  events: OrderEvent[];
  createdAt: string;
  updatedAt: string;
}

interface ApiResponse<T> {
  code: number;
  message?: string;
  data: T;
}

type Method = 'GET' | 'POST' | 'PUT';

function request<T>(method: Method, path: string, data?: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: API_BASE + path,
      method,
      data: data as WechatMiniprogram.IAnyObject,
      header: { 'content-type': 'application/json' },
      timeout: 8000,
      success: (res) => {
        const body = res.data as unknown as ApiResponse<T> | undefined;
        if (res.statusCode >= 200 && res.statusCode < 300 && body && body.code === 0) {
          resolve(body.data);
          return;
        }
        reject(new Error((body && body.message) || '请求失败（HTTP ' + res.statusCode + '）'));
      },
      fail: () => {
        reject(new Error('网络异常：请确认后端已启动，且已关闭「合法域名校验」'));
      }
    });
  });
}

export const api = {
  menu: (): Promise<MenuData> => request<MenuData>('GET', '/api/menu'),

  createOrder: (payload: {
    items: OrderItemInput[];
    address: Address;
    remark: string;
  }): Promise<OrderSummary> => request<OrderSummary>('POST', '/api/orders', payload),

  order: (id: string): Promise<OrderDetail> =>
    request<OrderDetail>('GET', '/api/orders/' + encodeURIComponent(id))
};
