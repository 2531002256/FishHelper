import { clamp, normalizeText, round, toNumber } from "./constants.js";

const RISK_KEYWORDS = {
  high: ["药", "医用", "液体", "品牌", "仿", "高仿", "电子烟", "食品"],
  medium: ["玻璃", "瓷", "大件", "易碎", "组装", "电器", "儿童"]
};

const CATEGORY_RULES = [
  { keywords: ["收纳", "置物", "整理"], value: "收纳整理" },
  { keywords: ["耳机", "键盘", "鼠标", "支架"], value: "3C数码" },
  { keywords: ["杯", "锅", "餐具", "厨房"], value: "厨房日用" },
  { keywords: ["女包", "手提", "项链", "耳饰"], value: "穿搭配饰" },
  { keywords: ["宠物", "猫", "狗"], value: "宠物用品" }
];

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

export function inferCategory(title = "", platform = "") {
  const text = normalizeText(title).toLowerCase();
  const matched = CATEGORY_RULES.find((rule) => includesAny(text, rule.keywords));
  if (matched) {
    return matched.value;
  }
  if (platform === "xianyu") {
    return "同行样本";
  }
  if (platform === "1688" || platform === "taobao" || platform === "pinduoduo") {
    return "货源候选";
  }
  return "未分类";
}

export function inferDemandLevel(product = {}) {
  const sales = toNumber(product?.sourceSignals?.sales);
  const ratingCount = toNumber(product?.sourceSignals?.ratingCount);
  if (sales >= 100 || ratingCount >= 50) {
    return "strong";
  }
  if (sales >= 20 || ratingCount >= 10) {
    return "medium";
  }
  return "weak";
}

export function inferCompetitionLevel(product = {}) {
  const title = normalizeText(product?.productTitle).toLowerCase();
  if (title.length <= 12) {
    return "high";
  }
  if (includesAny(title, ["收纳", "耳机", "数据线", "手机壳", "置物"])) {
    return "high";
  }
  if (includesAny(title, ["定制", "手作", "小众", "氛围"])) {
    return "low";
  }
  return "medium";
}

export function inferRiskLevel(product = {}) {
  const title = normalizeText(product?.productTitle).toLowerCase();
  if (includesAny(title, RISK_KEYWORDS.high)) {
    return "high";
  }
  if (includesAny(title, RISK_KEYWORDS.medium)) {
    return "medium";
  }
  return "low";
}

export function inferFulfillmentLevel(product = {}) {
  const title = normalizeText(product?.productTitle).toLowerCase();
  if (includesAny(title, ["大件", "组装", "家具", "多件套"])) {
    return "hard";
  }
  if (includesAny(title, ["玻璃", "陶瓷", "电器"])) {
    return "normal";
  }
  return "easy";
}

export function inferAnalysisPreset(product) {
  const originalPrice = toNumber(product?.originalPrice);
  const sourcePlatform = product?.sourcePlatform;
  const isSourcePlatform = ["1688", "pinduoduo", "taobao"].includes(sourcePlatform);
  const costPrice = product?.costPrice || (isSourcePlatform ? originalPrice : round(originalPrice * 0.62, 2));
  const expectedSalePrice =
    product?.suggestedPrice ||
    (isSourcePlatform ? round(Math.max(originalPrice * 1.55, originalPrice + 10), 2) : Math.max(originalPrice, round(costPrice * 1.4, 2)));

  return {
    costPrice: round(costPrice, 2),
    shippingFee: product?.shippingFee || (isSourcePlatform ? 8 : 0),
    packagingFee: product?.packagingFee || 2,
    expectedSalePrice: round(expectedSalePrice, 2),
    bargainingRate: sourcePlatform === "xianyu" ? 0.08 : 0.12,
    demandLevel: inferDemandLevel(product),
    competitionLevel: inferCompetitionLevel(product),
    riskLevel: inferRiskLevel(product),
    fulfillmentLevel: inferFulfillmentLevel(product)
  };
}

function scoreProfit(rate) {
  if (rate >= 0.5) {
    return 30;
  }
  if (rate >= 0.3) {
    return 20;
  }
  if (rate >= 0.15) {
    return 10;
  }
  return 0;
}

function scoreDemand(level) {
  return { strong: 20, medium: 12, weak: 6 }[level] ?? 6;
}

function scoreCompetition(level) {
  return { low: 20, medium: 10, high: 0 }[level] ?? 10;
}

function scoreFulfillment(level) {
  return { easy: 15, normal: 9, hard: 4 }[level] ?? 9;
}

function scoreRisk(level) {
  return { low: 15, medium: 8, high: 0 }[level] ?? 8;
}

export function calculateAnalysis(product, input) {
  const normalized = {
    costPrice: toNumber(input.costPrice),
    shippingFee: toNumber(input.shippingFee),
    packagingFee: toNumber(input.packagingFee),
    expectedSalePrice: toNumber(input.expectedSalePrice),
    bargainingRate: clamp(toNumber(input.bargainingRate, 0.1), 0, 0.5),
    demandLevel: input.demandLevel || "medium",
    competitionLevel: input.competitionLevel || "medium",
    riskLevel: input.riskLevel || "medium",
    fulfillmentLevel: input.fulfillmentLevel || "normal"
  };

  const totalCost = round(normalized.costPrice + normalized.shippingFee + normalized.packagingFee, 2);
  const bargainingSpace = round(normalized.expectedSalePrice * normalized.bargainingRate, 2);
  const estimatedProfit = round(normalized.expectedSalePrice - totalCost, 2);
  const minDealPrice = round(normalized.expectedSalePrice - bargainingSpace, 2);
  const minDealProfit = round(minDealPrice - totalCost, 2);
  const estimatedProfitRate = totalCost > 0 ? round(estimatedProfit / totalCost, 4) : 0;

  const scores = {
    profit: scoreProfit(estimatedProfitRate),
    demand: scoreDemand(normalized.demandLevel),
    competition: scoreCompetition(normalized.competitionLevel),
    fulfillment: scoreFulfillment(normalized.fulfillmentLevel),
    risk: scoreRisk(normalized.riskLevel)
  };
  const totalScore = clamp(scores.profit + scores.demand + scores.competition + scores.fulfillment + scores.risk, 0, 100);

  let recommendation = "不建议做";
  if (totalScore >= 80) {
    recommendation = "优先上架";
  } else if (totalScore >= 60) {
    recommendation = "可以测试";
  } else if (totalScore >= 45) {
    recommendation = "谨慎上架";
  }

  const riskHints = [];
  const normalizedTitle = normalizeText(product?.productTitle).toLowerCase();
  if (includesAny(normalizedTitle, RISK_KEYWORDS.high)) {
    riskHints.push("标题里包含高风险词，正式接 AI 或正式版规则前建议加入敏感词审核。");
  }
  if (normalized.competitionLevel === "high") {
    riskHints.push("当前判断为高竞争品，建议继续拆更细类目或场景再上架。");
  }
  if (estimatedProfitRate < 0.2) {
    riskHints.push("利润空间偏薄，容易被议价吃掉利润。");
  }
  if (!riskHints.length) {
    riskHints.push("当前风险处于可控区间，可以先用小样本测试。");
  }

  return {
    input: normalized,
    categoryName: product?.categoryName || inferCategory(product?.productTitle, product?.sourcePlatform),
    totalCost,
    bargainingSpace,
    minDealPrice,
    minDealProfit,
    estimatedProfit,
    estimatedProfitRate,
    scores,
    totalScore,
    recommendation,
    marketSummary: {
      demandLabel: normalized.demandLevel === "strong" ? "需求高" : normalized.demandLevel === "medium" ? "需求中" : "需求弱",
      competitionLabel:
        normalized.competitionLevel === "low" ? "竞争低" : normalized.competitionLevel === "medium" ? "竞争中" : "竞争高",
      riskLabel: normalized.riskLevel === "low" ? "低风险" : normalized.riskLevel === "medium" ? "中风险" : "高风险"
    },
    riskHints,
    updatedAt: new Date().toISOString()
  };
}
