/**
 * 后端地址
 *
 * - 开发者工具调试：保持 http://localhost:3000，并在「详情 → 本地设置」勾选
 *   「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」
 * - 真机预览 / 上线：改成已备案的 HTTPS 域名，并在
 *   mp.weixin.qq.com → 开发 → 开发管理 → 服务器域名 里把它加入 request 合法域名
 */
export const API_BASE = 'http://localhost:3000';

/** 订单状态轮询间隔（毫秒） */
export const POLL_INTERVAL = 5000;
