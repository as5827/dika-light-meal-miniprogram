/**
 * 极简结构化日志（JSON Lines，零依赖）
 *
 * 设计要点：
 * 1. 一行一条 JSON，方便 grep / jq / 直接对接日志采集，不用自己解析自由文本
 * 2. 手机号、口令、token 等字段在落盘前统一脱敏，避免日志变成泄漏面
 * 3. 按大小滚动（默认 5MB），只保留一个历史文件，不至于把小服务器磁盘写满
 * 4. 控制台与文件双写；CI 里用 LOG_TO_FILE=0 关掉文件，避免污染工作区
 */

const fs = require('fs');
const path = require('path');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = process.env.LOG_LEVEL || 'info';
const TO_FILE = process.env.LOG_TO_FILE !== '0';
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const MAX_BYTES = Number(process.env.LOG_MAX_BYTES || 5 * 1024 * 1024);

const MASK_KEY = /^(phone|mobile|password|passwd|token|authorization|apikey|api_key|secret|llm_api_key)$/i;
const PHONE = /^(\d{3})\d{4}(\d{4})$/;

let ready = false;
let bytes = 0;

function ensureFile() {
  if (ready || !TO_FILE) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    if (fs.existsSync(LOG_FILE)) bytes = fs.statSync(LOG_FILE).size;
    ready = true;
  } catch (e) {
    ready = false;
  }
}

function rotate() {
  try {
    const backup = LOG_FILE + '.1';
    fs.rmSync(backup, { force: true });
    fs.renameSync(LOG_FILE, backup);
    bytes = 0;
  } catch (e) {
    /* 滚动失败不影响主流程 */
  }
}

/** 递归脱敏：命中敏感字段名的值整体替换，字符串形态的手机号做掩码 */
function sanitize(value, depth = 0) {
  if (depth > 3) return '[deep]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return PHONE.test(value) ? value.replace(PHONE, '$1****$2') : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = MASK_KEY.test(key) ? '***' : sanitize(val, depth + 1);
  }
  return out;
}

function emit(level, event, data) {
  if (LEVELS[level] < (LEVELS[MIN_LEVEL] || LEVELS.info)) return;

  const record = { ts: new Date().toISOString(), level, event };
  if (data && typeof data === 'object') Object.assign(record, sanitize(data));

  const line = JSON.stringify(record);
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }

  if (!TO_FILE) return;
  ensureFile();
  if (!ready) return;

  try {
    if (bytes > MAX_BYTES) rotate();
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
    bytes += Buffer.byteLength(line) + 1;
  } catch (e) {
    ready = false; // 落盘失败时退回只打控制台，不抛错
  }
}

module.exports = {
  debug: (event, data) => emit('debug', event, data),
  info: (event, data) => emit('info', event, data),
  warn: (event, data) => emit('warn', event, data),
  error: (event, data) => emit('error', event, data),
  sanitize,
  file: LOG_FILE
};
