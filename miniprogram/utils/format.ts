/** 分 → 元，保留两位小数（金额全程以「分」为整数存储与计算） */
export function fenToYuan(fen: number): string {
  return (fen / 100).toFixed(2);
}

/** ISO 时间 → HH:mm */
export function clock(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => (n < 10 ? '0' + n : String(n));
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/** 手机号脱敏：13812345678 → 138****5678 */
export function maskPhone(phone: string): string {
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
}
