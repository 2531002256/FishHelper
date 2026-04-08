import { calculateAnalysis, inferAnalysisPreset } from "./shared/analysis.js";
import { buildCopyBundle, generateContentPackage } from "./shared/generation.js";
import { escapeHtml, formatCurrency, formatDateTime, formatPercent, STATUS_META, titleCasePlatform } from "./shared/constants.js";
import {
  buildProductFromParsed,
  createOrUpdateDraftFromProduct,
  findDuplicateProduct,
  getDashboardMetrics,
  getState,
  initState,
  saveProductAnalysis,
  saveProductGeneration,
  updateProductStatus,
  upsertProduct
} from "./shared/storage.js";

const tabButtons = [...document.querySelectorAll(".tab-button")];
const panels = [...document.querySelectorAll(".panel")];
const statusBanner = document.getElementById("statusBanner");
const currentProductCard = document.getElementById("currentProductCard");
const analysisResult = document.getElementById("analysisResult");
const contentResult = document.getElementById("contentResult");
const libraryList = document.getElementById("libraryList");

let state = null;
let activeProduct = null;
let activeAnalysis = null;
let activeContent = null;
let activePageState = null;
let selectedTitle = "";

const formEls = {
  costPrice: document.getElementById("costPrice"),
  shippingFee: document.getElementById("shippingFee"),
  packagingFee: document.getElementById("packagingFee"),
  expectedSalePrice: document.getElementById("expectedSalePrice"),
  bargainingRate: document.getElementById("bargainingRate"),
  demandLevel: document.getElementById("demandLevel"),
  competitionLevel: document.getElementById("competitionLevel"),
  riskLevel: document.getElementById("riskLevel"),
  fulfillmentLevel: document.getElementById("fulfillmentLevel")
};

async function parseActivePage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { supported: false, reason: "未找到当前标签页" };
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "FH_PARSE_PRODUCT" });
    return response?.payload || { supported: false, reason: response?.error || "解析失败" };
  } catch (error) {
    return {
      supported: false,
      reason: "当前页面暂不支持解析，请打开闲鱼 / 1688 / 拼多多 / 淘宝商品详情页"
    };
  }
}

function setBanner(message, tone = "info") {
  statusBanner.className = `status-banner ${tone}`;
  statusBanner.textContent = message;
}

function resetActiveWork() {
  activeProduct = null;
  activeAnalysis = null;
  activeContent = null;
  selectedTitle = "";
}

function isCollectBlockedPage(pageState = activePageState) {
  return Boolean(pageState?.supported && pageState?.canCollect === false);
}

function getBlockedCollectReason(pageState = activePageState) {
  return pageState?.reason || "当前页面不是可采集的商品详情页。";
}

function switchTab(tab) {
  tabButtons.forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab));
}

function getStatusTone(status) {
  return STATUS_META[status]?.tone || "slate";
}

function fillAnalysisForm(product) {
  const preset = inferAnalysisPreset(product);
  Object.entries(formEls).forEach(([key, element]) => {
    element.value = preset[key];
  });
}

function readAnalysisForm() {
  return {
    costPrice: formEls.costPrice.value,
    shippingFee: formEls.shippingFee.value,
    packagingFee: formEls.packagingFee.value,
    expectedSalePrice: formEls.expectedSalePrice.value,
    bargainingRate: formEls.bargainingRate.value,
    demandLevel: formEls.demandLevel.value,
    competitionLevel: formEls.competitionLevel.value,
    riskLevel: formEls.riskLevel.value,
    fulfillmentLevel: formEls.fulfillmentLevel.value
  };
}

function renderMetrics() {
  const metrics = getDashboardMetrics(state);
  document.getElementById("metricProducts").textContent = metrics.productCount;
  document.getElementById("metricHighScore").textContent = metrics.highScoreCount;
  document.getElementById("metricDrafts").textContent = metrics.draftCount;
  document.getElementById("metricPending").textContent = metrics.pendingListingCount;
}

function renderCurrentProduct() {
  if (!activeProduct) {
    if (isCollectBlockedPage()) {
      currentProductCard.innerHTML = `
        <article class="section-card">
          <p class="eyebrow">已识别闲鱼浏览页</p>
          <h2>当前页面还不能采集</h2>
          <p class="hero-copy">请先点进闲鱼商品详情页后再采集，详情页链接应为 https://www.goofish.com/item...</p>
        </article>
      `;
      return;
    }

    currentProductCard.innerHTML = `
      <article class="section-card">
        <p class="eyebrow">未识别到商品</p>
        <h2>请打开一个目标商品详情页</h2>
        <p class="hero-copy">支持闲鱼、1688、拼多多、淘宝商品详情页。识别成功后，这里会展示标题、价格、平台和素材预览。</p>
      </article>
    `;
    return;
  }

  const duplicate = findDuplicateProduct(activeProduct, state.products.filter((item) => item.id !== activeProduct.id));
  currentProductCard.innerHTML = `
    <article class="section-card">
      <div class="product-summary">
        ${
          activeProduct.mainImageUrl
            ? `<img class="product-thumb" src="${escapeHtml(activeProduct.mainImageUrl)}" alt="商品图" />`
            : `<div class="empty-thumb">样本</div>`
        }
        <div class="info-grid">
          <div>
            <div class="badge-row">
              <span class="badge">${escapeHtml(titleCasePlatform(activeProduct.sourcePlatform))}</span>
              <span class="status-chip ${getStatusTone(activeProduct.status)}">${escapeHtml(activeProduct.status)}</span>
              ${duplicate ? `<span class="badge">疑似重复商品</span>` : `<span class="badge">可直接采集</span>`}
            </div>
            <h2 class="product-title">${escapeHtml(activeProduct.productTitle || "未获取到标题")}</h2>
            <p class="meta-line">当前价格：${formatCurrency(activeProduct.originalPrice)} / 类目：${escapeHtml(activeProduct.categoryName || "未分类")}</p>
            <p class="mini-meta">来源链接已识别，素材图 ${activeProduct.imageUrls.length} 张，SKU 线索：${escapeHtml(activeProduct.skuSummary || "未获取")}</p>
          </div>
          <div class="tag-row">
            <span class="tag">销量 ${escapeHtml(String(activeProduct.sourceSignals?.sales || 0))}</span>
            <span class="tag">评价 ${escapeHtml(String(activeProduct.sourceSignals?.ratingCount || 0))}</span>
            <span class="tag">发货地 ${escapeHtml(activeProduct.sourceSignals?.location || "未获取")}</span>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderAnalysis() {
  if (!activeProduct || !activeAnalysis) {
    analysisResult.innerHTML = `<article class="section-card"><p class="hero-copy">先识别一个商品，再点击“重新计算”或“生成上品内容”。</p></article>`;
    return;
  }

  analysisResult.innerHTML = `
    <article class="section-card">
      <div class="result-grid">
        <div class="info-card"><span>预计利润</span><strong>${formatCurrency(activeAnalysis.estimatedProfit)}</strong><div class="mini-meta">利润率 ${formatPercent(activeAnalysis.estimatedProfitRate)}</div></div>
        <div class="info-card"><span>综合评分</span><strong>${activeAnalysis.totalScore}</strong><div class="mini-meta">${escapeHtml(activeAnalysis.recommendation)}</div></div>
        <div class="info-card"><span>最低成交价</span><strong>${formatCurrency(activeAnalysis.minDealPrice)}</strong><div class="mini-meta">含议价缓冲</div></div>
        <div class="info-card"><span>总成本</span><strong>${formatCurrency(activeAnalysis.totalCost)}</strong><div class="mini-meta">${escapeHtml(activeAnalysis.marketSummary.riskLabel)}</div></div>
      </div>
    </article>
    <article class="section-card">
      <div class="section-header">
        <div>
          <p class="eyebrow">评分拆解</p>
          <h2>${escapeHtml(activeAnalysis.marketSummary.demandLabel)} / ${escapeHtml(activeAnalysis.marketSummary.competitionLabel)}</h2>
        </div>
      </div>
      <div class="result-grid">
        <div class="info-card"><span>利润分</span><strong>${activeAnalysis.scores.profit}</strong></div>
        <div class="info-card"><span>需求分</span><strong>${activeAnalysis.scores.demand}</strong></div>
        <div class="info-card"><span>竞争分</span><strong>${activeAnalysis.scores.competition}</strong></div>
        <div class="info-card"><span>履约分</span><strong>${activeAnalysis.scores.fulfillment}</strong></div>
      </div>
    </article>
    <article class="section-card">
      <p class="eyebrow">风险提示</p>
      <div class="stack">
        ${activeAnalysis.riskHints.map((hint) => `<div class="list-item"><div class="mini-meta">${escapeHtml(hint)}</div></div>`).join("")}
      </div>
    </article>
  `;
}

function renderContent() {
  if (!activeProduct || !activeContent) {
    contentResult.innerHTML = `<article class="section-card"><p class="hero-copy">生成后，这里会给出 5 个标题版本、描述、标签和价格建议。</p></article>`;
    return;
  }

  contentResult.innerHTML = `
    <article class="section-card">
      <div class="section-header">
        <div>
          <p class="eyebrow">标题方案</p>
          <h2>默认标题：${escapeHtml(selectedTitle || activeContent.selectedTitle)}</h2>
        </div>
      </div>
      <div class="title-list">
        ${activeContent.titles
          .map(
            (title) => `
              <div class="title-option ${title === selectedTitle ? "active" : ""}" data-role="title-option">
                <div>${escapeHtml(title)}</div>
                <button class="ghost-button" data-action="select-title" data-title="${escapeHtml(title)}">设为默认</button>
              </div>
            `
          )
          .join("")}
      </div>
    </article>
    <article class="section-card">
      <p class="eyebrow">描述文案</p>
      <textarea id="generatedDescription" class="copy-area">${escapeHtml(activeContent.description)}</textarea>
      <div class="tag-row">${activeContent.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
    </article>
    <article class="section-card">
      <p class="eyebrow">价格建议</p>
      <div class="price-grid">
        <div class="info-card"><span>建议售价</span><strong>${formatCurrency(activeContent.pricePlan.suggestedPrice)}</strong></div>
        <div class="info-card"><span>最低成交价</span><strong>${formatCurrency(activeContent.pricePlan.minDealPrice)}</strong></div>
        <div class="info-card"><span>引流价</span><strong>${formatCurrency(activeContent.pricePlan.trafficPrice)}</strong></div>
        <div class="info-card"><span>正常利润价</span><strong>${formatCurrency(activeContent.pricePlan.regularPrice)}</strong></div>
      </div>
    </article>
    <article class="section-card">
      <p class="eyebrow">图片素材</p>
      <div class="media-strip">
        ${(activeContent.media.images || []).map((image) => `<img src="${escapeHtml(image)}" alt="素材图" />`).join("")}
      </div>
    </article>
  `;
}

function renderLibrary() {
  const platformFilter = document.getElementById("libraryPlatformFilter").value;
  const statusFilter = document.getElementById("libraryStatusFilter").value;
  const items = state.products.filter((product) => {
    if (platformFilter && product.sourcePlatform !== platformFilter) {
      return false;
    }
    if (statusFilter && product.status !== statusFilter) {
      return false;
    }
    return true;
  });

  libraryList.innerHTML =
    items
      .map(
        (product) => `
          <article class="list-item" data-product-id="${product.id}">
            <div class="badge-row">
              <span class="badge">${escapeHtml(titleCasePlatform(product.sourcePlatform))}</span>
              <span class="status-chip ${getStatusTone(product.status)}">${escapeHtml(product.status)}</span>
              <span class="badge">评分 ${escapeHtml(String(product.scoreTotal || 0))}</span>
            </div>
            <h3 class="product-title">${escapeHtml(product.productTitle)}</h3>
            <p class="mini-meta">建议售价 ${formatCurrency(product.suggestedPrice || product.originalPrice)} / 更新时间 ${formatDateTime(product.updatedAt)}</p>
          </article>
        `
      )
      .join("") || `<article class="section-card"><p class="hero-copy">还没有采集商品。先在目标商品页点击“采集商品”。</p></article>`;
}

function renderAll() {
  renderMetrics();
  renderCurrentProduct();
  renderAnalysis();
  renderContent();
  renderLibrary();
}

async function refreshActiveProduct() {
  setBanner("正在重新识别当前页面...", "info");
  const parsed = await parseActivePage();
  activePageState = parsed;

  if (!parsed.supported) {
    resetActiveWork();
    renderAll();
    setBanner(parsed.reason || "当前页面暂不支持解析", "warning");
    return;
  }

  if (parsed.canCollect === false) {
    resetActiveWork();
    renderAll();
    setBanner(parsed.reason || "当前页面暂不支持解析", "warning");
    return;
  }

  const candidate = buildProductFromParsed(parsed);
  const existed = findDuplicateProduct(candidate, state.products);
  activeProduct = existed
    ? {
        ...existed,
        ...candidate,
        id: existed.id,
        createdAt: existed.createdAt,
        imageUrls: Array.from(new Set([...(existed.imageUrls || []), ...(candidate.imageUrls || [])]))
      }
    : candidate;

  fillAnalysisForm(activeProduct);
  activeAnalysis = calculateAnalysis(activeProduct, readAnalysisForm());
  activeContent = generateContentPackage(activeProduct, activeAnalysis);
  selectedTitle = activeContent.selectedTitle;
  renderAll();
  setBanner(`已识别 ${titleCasePlatform(activeProduct.sourcePlatform)} 商品，可直接采集或继续分析。`, "success");
}

async function persistActiveWork({ withAnalysis = false, withContent = false, withDraft = false } = {}) {
  if (!activeProduct) {
    return null;
  }

  const collectResult = await upsertProduct(activeProduct);
  state = collectResult.state;
  activeProduct = collectResult.savedProduct;

  if (withAnalysis && activeAnalysis) {
    const analysisResult = await saveProductAnalysis(activeProduct.id, activeAnalysis);
    state = analysisResult.state;
    activeProduct = analysisResult.product;
  }

  if (withContent && activeContent) {
    const packageToSave = { ...activeContent, selectedTitle };
    const contentSaveResult = await saveProductGeneration(activeProduct.id, packageToSave);
    state = contentSaveResult.state;
    activeProduct = contentSaveResult.product;
    activeContent = packageToSave;
  }

  if (withDraft) {
    return createOrUpdateDraftFromProduct(activeProduct.id);
  }

  return collectResult;
}

function copyText(text, successMessage) {
  navigator.clipboard.writeText(text).then(() => setBanner(successMessage, "success"));
}

function bindEvents() {
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  document.getElementById("refreshPage").addEventListener("click", refreshActiveProduct);
  document.getElementById("jumpToAnalysis").addEventListener("click", () => switchTab("analysis"));
  document.getElementById("openDashboard").addEventListener("click", () => chrome.runtime.openOptionsPage());

  document.getElementById("collectProduct").addEventListener("click", async () => {
    if (isCollectBlockedPage()) {
      setBanner(getBlockedCollectReason(), "warning");
      return;
    }
    if (!activeProduct) {
      setBanner("请先打开并识别一个商品详情页。", "warning");
      return;
    }
    const result = await persistActiveWork();
    const duplicateText = result?.duplicate ? "，已合并疑似重复商品" : "";
    setBanner(`商品采集成功${duplicateText}。`, "success");
    renderAll();
  });

  document.getElementById("recalculate").addEventListener("click", () => {
    if (!activeProduct) {
      setBanner("请先识别一个商品页面。", "warning");
      return;
    }
    activeAnalysis = calculateAnalysis(activeProduct, readAnalysisForm());
    activeContent = generateContentPackage(activeProduct, activeAnalysis);
    selectedTitle = activeContent.selectedTitle;
    renderAll();
    setBanner("利润和评分已更新。", "success");
  });

  document.getElementById("saveAnalysis").addEventListener("click", async () => {
    if (!activeProduct) {
      setBanner("请先打开并识别一个商品详情页。", "warning");
      return;
    }
    activeAnalysis = calculateAnalysis(activeProduct, readAnalysisForm());
    await persistActiveWork({ withAnalysis: true });
    renderAll();
    setBanner("分析结果已保存到商品库。", "success");
  });

  document.getElementById("generateContent").addEventListener("click", async () => {
    if (!activeProduct) {
      setBanner("请先打开并识别一个商品详情页。", "warning");
      return;
    }
    activeAnalysis = calculateAnalysis(activeProduct, readAnalysisForm());
    activeContent = generateContentPackage(activeProduct, activeAnalysis);
    selectedTitle = activeContent.selectedTitle;
    await persistActiveWork({ withAnalysis: true, withContent: true });
    renderAll();
    switchTab("content");
    setBanner("已生成上品内容，并同步到商品库。", "success");
  });

  document.getElementById("copySelectedTitle").addEventListener("click", () => {
    if (selectedTitle) {
      copyText(selectedTitle, "标题已复制。");
    }
  });

  document.getElementById("copyDescription").addEventListener("click", () => {
    if (!activeContent) {
      return;
    }
    const textarea = document.getElementById("generatedDescription");
    copyText(textarea?.value || activeContent.description, "描述已复制。");
  });

  document.getElementById("copyAll").addEventListener("click", () => {
    if (!activeContent) {
      return;
    }
    const draftLike = {
      draftTitle: selectedTitle,
      draftPrice: activeContent.pricePlan.suggestedPrice,
      draftTags: activeContent.tags,
      draftDesc: document.getElementById("generatedDescription")?.value || activeContent.description
    };
    copyText(buildCopyBundle(draftLike), "标题、价格、标签和描述已复制。");
  });

  document.getElementById("saveDraft").addEventListener("click", async () => {
    if (!activeProduct) {
      setBanner("请先打开并识别一个商品详情页。", "warning");
      return;
    }
    const textarea = document.getElementById("generatedDescription");
    if (activeContent) {
      activeContent = {
        ...activeContent,
        selectedTitle,
        description: textarea?.value || activeContent.description
      };
    }
    const draftResult = await persistActiveWork({ withAnalysis: true, withContent: true, withDraft: true });
    state = draftResult.state;
    renderAll();
    setBanner("草稿保存成功，可在后台草稿箱继续管理。", "success");
  });

  document.getElementById("markListed").addEventListener("click", async () => {
    if (!activeProduct?.id) {
      setBanner("请先采集商品。", "warning");
      return;
    }
    const result = await updateProductStatus(activeProduct.id, "已上架");
    state = result.state;
    activeProduct = result.product;
    renderAll();
    setBanner("商品已标记为已上架。", "success");
  });

  document.getElementById("libraryPlatformFilter").addEventListener("change", renderLibrary);
  document.getElementById("libraryStatusFilter").addEventListener("change", renderLibrary);

  contentResult.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) {
      return;
    }
    if (action.dataset.action === "select-title") {
      selectedTitle = action.dataset.title;
      renderContent();
      setBanner("默认标题已切换。", "success");
    }
  });

  libraryList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-product-id]");
    if (!item) {
      return;
    }
    const product = state.products.find((entry) => entry.id === item.dataset.productId);
    if (!product) {
      return;
    }
    activePageState = null;
    activeProduct = product;
    fillAnalysisForm(product);
    activeAnalysis = product.analysis || calculateAnalysis(product, readAnalysisForm());
    activeContent = product.generated || generateContentPackage(product, activeAnalysis);
    selectedTitle = activeContent.selectedTitle;
    renderAll();
    switchTab("current");
    setBanner("已载入该商品，可继续编辑分析和上品内容。", "success");
  });
}

async function boot() {
  await initState();
  state = await getState();
  bindEvents();
  renderAll();
  await refreshActiveProduct();
}

boot();
