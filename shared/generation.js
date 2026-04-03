import { formatCurrency, normalizeText, uniqueList } from "./constants.js";

const TITLE_STOP_WORDS = ["闲鱼", "同款", "爆款", "热卖", "官方", "正品", "新品", "现货", "包邮", "店铺"];
const SENSITIVE_WORDS = ["全网最低", "稳赚", "绝版", "官方正品", "百分百", "绝对"];

function extractKeywords(title = "") {
  return uniqueList(
    normalizeText(title)
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, " ")
      .split(" ")
      .map((item) => item.trim())
      .filter((item) => item.length >= 2 && !TITLE_STOP_WORDS.includes(item))
      .slice(0, 6)
  );
}

function stripSensitive(text) {
  let output = text;
  SENSITIVE_WORDS.forEach((word) => {
    output = output.replaceAll(word, "");
  });
  return output.replace(/\s+/g, " ").trim();
}

function limitTitle(text) {
  return stripSensitive(text).slice(0, 28);
}

function buildFeatureLine(analysis) {
  if (!analysis) {
    return "适合先做小样本测试";
  }
  if (analysis.recommendation === "优先上架") {
    return "利润空间和风险表现都比较平衡";
  }
  if (analysis.recommendation === "可以测试") {
    return "建议先跑 3-5 单验证转化";
  }
  if (analysis.recommendation === "谨慎上架") {
    return "建议继续优化定价和标题后再上架";
  }
  return "当前更适合作为观察样本，不建议直接重仓";
}

export function generatePricePlan(product, analysis) {
  const suggested = analysis?.input?.expectedSalePrice || product?.suggestedPrice || product?.originalPrice || 0;
  const minDeal = analysis?.minDealPrice || Math.max(suggested * 0.92, 0);
  const traffic = Math.max(suggested * 0.88, 0);
  const regular = Math.max(suggested * 1.03, 0);
  return {
    suggestedPrice: Number(suggested.toFixed(2)),
    minDealPrice: Number(minDeal.toFixed(2)),
    trafficPrice: Number(traffic.toFixed(2)),
    regularPrice: Number(regular.toFixed(2))
  };
}

export function generateContentPackage(product, analysis) {
  const keywords = extractKeywords(product?.productTitle);
  const category = product?.categoryName || keywords[0] || "好物";
  const coreA = keywords[0] || category;
  const coreB = keywords[1] || "实拍";
  const coreC = keywords[2] || "现货";
  const pricePlan = generatePricePlan(product, analysis);
  const priceTag = formatCurrency(pricePlan.suggestedPrice);

  const titles = uniqueList([
    limitTitle(`${coreA} ${coreB} 搜索流量款 ${priceTag}`),
    limitTitle(`低价出${coreA} ${coreB} 引流版`),
    limitTitle(`${coreA}${coreB} 卖点展示款 好出单`),
    limitTitle(`${coreA} ${coreC} 精简稳妥版`),
    limitTitle(`${category} 自用转卖同款 适合闲鱼`)
  ]).slice(0, 5);

  const tags = uniqueList([
    ...keywords,
    category,
    analysis?.marketSummary?.competitionLabel,
    analysis?.marketSummary?.demandLabel,
    "闲鱼上架"
  ]).slice(0, 8);

  const descriptionLines = [
    `商品名称：${product?.productTitle || category}`,
    `建议售价：${formatCurrency(pricePlan.suggestedPrice)}，低价引流可从 ${formatCurrency(pricePlan.trafficPrice)} 起测。`,
    `核心判断：${buildFeatureLine(analysis)}。`,
    `卖点建议：优先突出 ${keywords.slice(0, 3).join(" / ") || "颜值、实用、性价比"}。`,
    `发货说明：默认 24 小时内安排，支持先沟通再拍。`,
    `售后说明：签收后先验货，有问题及时联系，友好协商处理。`,
    `温馨提示：${analysis?.riskHints?.[0] || "标题和描述都建议保留自然口语，避免夸大承诺。"}`
  ];

  return {
    titles,
    selectedTitle: titles[0] || product?.productTitle || category,
    description: descriptionLines.join("\n"),
    tags,
    pricePlan,
    media: {
      coverImage: product?.mainImageUrl || "",
      images: product?.imageUrls || []
    },
    updatedAt: new Date().toISOString()
  };
}

export function buildCopyBundle(draft) {
  if (!draft) {
    return "";
  }
  return [
    `标题：${draft.draftTitle}`,
    `价格：${formatCurrency(draft.draftPrice)}`,
    `标签：${(draft.draftTags || []).join(" / ")}`,
    "",
    draft.draftDesc || ""
  ].join("\n");
}
