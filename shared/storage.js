import { inferCategory } from "./analysis.js";
import { PLATFORM_META, STORAGE_KEY, dayKey, normalizeText, toNumber, uid, uniqueList } from "./constants.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function createInitialState() {
  const now = nowIso();
  return {
    version: 1,
    meta: {
      createdAt: now,
      updatedAt: now
    },
    products: [],
    drafts: [],
    preferences: {
      lastSection: "overview"
    }
  };
}

function extractSourceProductId(url = "") {
  const match = url.match(/(?:id=|offer\/|item\/|detail\/)([A-Za-z0-9_-]+)/i);
  return match ? match[1] : "";
}

function titleSimilarity(a = "", b = "") {
  const left = new Set(normalizeText(a).toLowerCase().split(/\s+/).filter(Boolean));
  const right = new Set(normalizeText(b).toLowerCase().split(/\s+/).filter(Boolean));
  if (!left.size || !right.size) {
    return 0;
  }
  let hit = 0;
  left.forEach((item) => {
    if (right.has(item)) {
      hit += 1;
    }
  });
  return hit / new Set([...left, ...right]).size;
}

function normalizeProduct(raw = {}) {
  const now = nowIso();
  return {
    id: raw.id || uid("prod"),
    sourcePlatform: raw.sourcePlatform || "unknown",
    sourceUrl: raw.sourceUrl || "",
    sourceProductId: raw.sourceProductId || extractSourceProductId(raw.sourceUrl || ""),
    productTitle: normalizeText(raw.productTitle),
    originalPrice: toNumber(raw.originalPrice),
    couponPrice: toNumber(raw.couponPrice),
    costPrice: toNumber(raw.costPrice),
    shippingFee: toNumber(raw.shippingFee),
    packagingFee: toNumber(raw.packagingFee),
    suggestedPrice: toNumber(raw.suggestedPrice),
    minDealPrice: toNumber(raw.minDealPrice),
    estimatedProfit: toNumber(raw.estimatedProfit),
    estimatedProfitRate: toNumber(raw.estimatedProfitRate),
    categoryName: raw.categoryName || inferCategory(raw.productTitle, raw.sourcePlatform),
    mainImageUrl: raw.mainImageUrl || "",
    imageUrls: uniqueList(raw.imageUrls || []),
    videoUrls: uniqueList(raw.videoUrls || []),
    skuSummary: normalizeText(raw.skuSummary),
    descText: normalizeText(raw.descText),
    sourceSignals: {
      sales: toNumber(raw.sourceSignals?.sales),
      ratingCount: toNumber(raw.sourceSignals?.ratingCount),
      location: raw.sourceSignals?.location || "",
      hostname: raw.sourceSignals?.hostname || ""
    },
    scoreTotal: toNumber(raw.scoreTotal),
    scoreProfit: toNumber(raw.scoreProfit),
    scoreDemand: toNumber(raw.scoreDemand),
    scoreCompetition: toNumber(raw.scoreCompetition),
    scoreRisk: toNumber(raw.scoreRisk),
    riskLevel: raw.riskLevel || "medium",
    status: raw.status || "待分析",
    notes: raw.notes || "",
    analysis: raw.analysis || null,
    generated: raw.generated || null,
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now
  };
}

function normalizeDraft(raw = {}) {
  const now = nowIso();
  return {
    id: raw.id || uid("draft"),
    productId: raw.productId || "",
    productTitle: normalizeText(raw.productTitle),
    draftTitle: normalizeText(raw.draftTitle),
    draftDesc: raw.draftDesc || "",
    draftTags: uniqueList(raw.draftTags || []),
    draftPrice: toNumber(raw.draftPrice),
    coverImage: raw.coverImage || "",
    selectedImages: uniqueList(raw.selectedImages || []),
    versionNo: Math.max(1, Number(raw.versionNo) || 1),
    sourcePlatform: raw.sourcePlatform || "unknown",
    status: raw.status || "待上架",
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now
  };
}

function normalizeState(raw = {}) {
  const base = createInitialState();
  return {
    version: 1,
    meta: {
      ...base.meta,
      ...(raw.meta || {})
    },
    products: Array.isArray(raw.products)
      ? raw.products.map(normalizeProduct).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      : [],
    drafts: Array.isArray(raw.drafts)
      ? raw.drafts.map(normalizeDraft).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      : [],
    preferences: {
      ...base.preferences,
      ...(raw.preferences || {})
    }
  };
}

async function writeState(state) {
  const next = normalizeState(state);
  next.meta.updatedAt = nowIso();
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

async function mutateState(mutator) {
  const current = await getState();
  const draft = clone(current);
  const result = mutator(draft);
  return writeState(result || draft);
}

export async function initState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (!stored[STORAGE_KEY]) {
    const initial = createInitialState();
    await chrome.storage.local.set({ [STORAGE_KEY]: initial });
    return initial;
  }
  const normalized = normalizeState(stored[STORAGE_KEY]);
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
  return normalized;
}

export async function getState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeState(stored[STORAGE_KEY] || createInitialState());
}

export function buildProductFromParsed(parsed) {
  const now = nowIso();
  return normalizeProduct({
    id: uid("prod"),
    sourcePlatform: parsed.platform || "unknown",
    sourceUrl: parsed.url || "",
    sourceProductId: extractSourceProductId(parsed.url || ""),
    productTitle: parsed.title || "",
    originalPrice: toNumber(parsed.price),
    couponPrice: toNumber(parsed.couponPrice),
    categoryName: inferCategory(parsed.title, parsed.platform),
    mainImageUrl: parsed.images?.[0] || "",
    imageUrls: parsed.images || [],
    skuSummary: parsed.skuSummary || "",
    descText: parsed.description || "",
    sourceSignals: {
      sales: toNumber(parsed.sales),
      ratingCount: toNumber(parsed.ratingCount),
      location: parsed.location || "",
      hostname: parsed.hostname || ""
    },
    status: "待分析",
    createdAt: now,
    updatedAt: now
  });
}

export function findDuplicateProduct(candidate, products = []) {
  return (
    products.find((product) => {
      if (candidate.sourceUrl && product.sourceUrl === candidate.sourceUrl) {
        return true;
      }
      if (
        candidate.sourceProductId &&
        product.sourceProductId &&
        candidate.sourceProductId === product.sourceProductId &&
        candidate.sourcePlatform === product.sourcePlatform
      ) {
        return true;
      }
      if (titleSimilarity(candidate.productTitle, product.productTitle) >= 0.8) {
        return true;
      }
      return false;
    }) || null
  );
}

function mergeProduct(base, incoming) {
  return normalizeProduct({
    ...base,
    ...incoming,
    imageUrls: uniqueList([...(base.imageUrls || []), ...(incoming.imageUrls || [])]),
    updatedAt: nowIso(),
    createdAt: base.createdAt || incoming.createdAt || nowIso()
  });
}

export async function upsertProduct(candidate) {
  let savedProduct = null;
  let duplicate = null;

  const state = await mutateState((draft) => {
    duplicate = findDuplicateProduct(candidate, draft.products);
    if (duplicate) {
      savedProduct = mergeProduct(duplicate, candidate);
      draft.products = draft.products.map((item) => (item.id === duplicate.id ? savedProduct : item));
    } else {
      savedProduct = normalizeProduct(candidate);
      draft.products.unshift(savedProduct);
    }
    return draft;
  });

  return { state, savedProduct, duplicate };
}

export async function saveProductAnalysis(productId, analysis) {
  let updatedProduct = null;
  const state = await mutateState((draft) => {
    draft.products = draft.products.map((product) => {
      if (product.id !== productId) {
        return product;
      }
      updatedProduct = normalizeProduct({
        ...product,
        costPrice: analysis.input.costPrice,
        shippingFee: analysis.input.shippingFee,
        packagingFee: analysis.input.packagingFee,
        suggestedPrice: analysis.input.expectedSalePrice,
        minDealPrice: analysis.minDealPrice,
        estimatedProfit: analysis.estimatedProfit,
        estimatedProfitRate: analysis.estimatedProfitRate,
        scoreTotal: analysis.totalScore,
        scoreProfit: analysis.scores.profit,
        scoreDemand: analysis.scores.demand,
        scoreCompetition: analysis.scores.competition,
        scoreRisk: analysis.scores.risk,
        riskLevel: analysis.input.riskLevel,
        analysis,
        status: product.generated ? "待上架" : "待生成内容",
        updatedAt: nowIso()
      });
      return updatedProduct;
    });
    return draft;
  });
  return { state, product: updatedProduct };
}

export async function saveProductGeneration(productId, generated) {
  let updatedProduct = null;
  const state = await mutateState((draft) => {
    draft.products = draft.products.map((product) => {
      if (product.id !== productId) {
        return product;
      }
      updatedProduct = normalizeProduct({
        ...product,
        generated,
        suggestedPrice: generated.pricePlan?.suggestedPrice || product.suggestedPrice,
        minDealPrice: generated.pricePlan?.minDealPrice || product.minDealPrice,
        status: "待上架",
        updatedAt: nowIso()
      });
      return updatedProduct;
    });
    return draft;
  });
  return { state, product: updatedProduct };
}

export async function createOrUpdateDraftFromProduct(productId) {
  let createdDraft = null;
  let updatedProduct = null;
  const state = await mutateState((draft) => {
    const sourceProduct = draft.products.find((item) => item.id === productId);
    if (!sourceProduct?.generated) {
      return draft;
    }

    draft.products = draft.products.map((product) => {
      if (product.id !== productId) {
        return product;
      }
      updatedProduct = normalizeProduct({
        ...product,
        status: "待上架",
        updatedAt: nowIso()
      });
      return updatedProduct;
    });

    const existed = draft.drafts.find((item) => item.productId === productId);
    createdDraft = normalizeDraft({
      ...existed,
      id: existed?.id || uid("draft"),
      productId,
      productTitle: sourceProduct.productTitle,
      draftTitle: sourceProduct.generated.selectedTitle,
      draftDesc: sourceProduct.generated.description,
      draftTags: sourceProduct.generated.tags,
      draftPrice: sourceProduct.generated.pricePlan?.suggestedPrice || sourceProduct.suggestedPrice,
      coverImage: sourceProduct.generated.media?.coverImage || sourceProduct.mainImageUrl,
      selectedImages: sourceProduct.generated.media?.images || sourceProduct.imageUrls,
      sourcePlatform: sourceProduct.sourcePlatform,
      versionNo: existed ? existed.versionNo + 1 : 1,
      status: "待上架",
      updatedAt: nowIso()
    });

    draft.drafts = existed
      ? draft.drafts.map((item) => (item.id === existed.id ? createdDraft : item))
      : [createdDraft, ...draft.drafts];

    return draft;
  });
  return { state, draft: createdDraft, product: updatedProduct };
}

export async function updateProductStatus(productId, status) {
  let updatedProduct = null;
  const state = await mutateState((draft) => {
    draft.products = draft.products.map((product) => {
      if (product.id !== productId) {
        return product;
      }
      updatedProduct = normalizeProduct({
        ...product,
        status,
        updatedAt: nowIso()
      });
      return updatedProduct;
    });
    draft.drafts = draft.drafts.map((item) =>
      item.productId === productId
        ? normalizeDraft({
            ...item,
            status: status === "已上架" ? "已完成" : item.status,
            updatedAt: nowIso()
          })
        : item
    );
    return draft;
  });
  return { state, product: updatedProduct };
}

export async function updateDraft(draftId, patch) {
  let updatedDraft = null;
  const state = await mutateState((draft) => {
    draft.drafts = draft.drafts.map((item) => {
      if (item.id !== draftId) {
        return item;
      }
      updatedDraft = normalizeDraft({
        ...item,
        ...patch,
        updatedAt: nowIso()
      });
      return updatedDraft;
    });
    return draft;
  });
  return { state, draft: updatedDraft };
}

export async function deleteProduct(productId) {
  return mutateState((draft) => {
    draft.products = draft.products.filter((item) => item.id !== productId);
    draft.drafts = draft.drafts.filter((item) => item.productId !== productId);
    return draft;
  });
}

export async function deleteDraft(draftId) {
  return mutateState((draft) => {
    draft.drafts = draft.drafts.filter((item) => item.id !== draftId);
    return draft;
  });
}

export function getDashboardMetrics(state) {
  const today = dayKey();
  const productCount = state.products.length;
  const draftCount = state.drafts.length;
  const todayCaptureCount = state.products.filter((product) => dayKey(product.createdAt) === today).length;
  const highScoreCount = state.products.filter((product) => Number(product.scoreTotal) >= 80).length;
  const pendingListingCount = state.products.filter((product) => product.status === "待上架").length;
  const listedCount = state.products.filter((product) => product.status === "已上架").length;

  const trendDays = Array.from({ length: 7 }).map((_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const key = dayKey(date);
    return {
      key,
      label: key.slice(5),
      captures: state.products.filter((product) => dayKey(product.createdAt) === key).length,
      highScore: state.products.filter((product) => dayKey(product.updatedAt) === key && Number(product.scoreTotal) >= 80).length
    };
  });

  const categoryDistribution = Object.entries(
    state.products.reduce((acc, product) => {
      const key = product.categoryName || PLATFORM_META[product.sourcePlatform]?.label || "未分类";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  )
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    productCount,
    draftCount,
    todayCaptureCount,
    highScoreCount,
    pendingListingCount,
    listedCount,
    trendDays,
    categoryDistribution
  };
}
