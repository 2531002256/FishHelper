export const STORAGE_KEY = "fishhelper_state_v1";

export const PLATFORM_META = {
  xianyu: { label: "闲鱼", accent: "#ff9f5a" },
  "1688": { label: "1688", accent: "#f36a2b" },
  pinduoduo: { label: "拼多多", accent: "#e0245e" },
  taobao: { label: "淘宝", accent: "#ff6200" },
  unknown: { label: "未知来源", accent: "#6b7280" }
};

export const STATUS_META = {
  "待分析": { tone: "slate" },
  "待生成内容": { tone: "amber" },
  "待上架": { tone: "blue" },
  "已上架": { tone: "green" },
  "已淘汰": { tone: "rose" }
};

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function clamp(value, min = 0, max = 100) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return min;
  }
  return Math.min(max, Math.max(min, num));
}

export function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const text = normalizeText(value)
    .replace(/[,，]/g, "")
    .replace(/(￥|¥|元|价格|售价|券后|折后|参考价|起|约)/g, "");
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : fallback;
}

export function round(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }
  const base = 10 ** digits;
  return Math.round(num * base) / base;
}

export function formatCurrency(value) {
  const num = round(value, 2);
  return `￥${num.toFixed(num >= 100 ? 0 : 2).replace(/\.00$/, "")}`;
}

export function formatPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return "0%";
  }
  return `${round(num * 100, 1).toFixed(1).replace(/\.0$/, "")}%`;
}

export function formatDateTime(value) {
  if (!value) {
    return "未记录";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "未记录";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function dayKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function titleCasePlatform(platform) {
  return PLATFORM_META[platform]?.label ?? PLATFORM_META.unknown.label;
}

export function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function uniqueList(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}
