import { API_BASE } from './services/config';

App<IAppOption>({
  globalData: {
    apiBase: API_BASE,
    lastOrderId: ''
  },
  onLaunch() {
    // 本地调试时在控制台确认后端地址，避免误连到线上环境
    console.log('[dika] API_BASE =', API_BASE);
  }
});
