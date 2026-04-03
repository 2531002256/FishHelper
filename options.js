import { buildCopyBundle, generateContentPackage } from "./shared/generation.js";
import { escapeHtml, formatCurrency, formatDateTime, formatPercent, STATUS_META, titleCasePlatform } from "./shared/constants.js";
import {
  createOrUpdateDraftFromProduct,
  deleteDraft,
  deleteProduct,
  getDashboardMetrics,
  getState,
  initState,
  saveProductGeneration,
  updateDraft,
  updateProductStatus
} from "./shared/storage.js";

const sideLinks = [...document.querySelectorAll(".side-link")];
const views = [...document.querySelectorAll(".workspace-view")];
let state = null;
let selectedProductId = null;
let selectedDraftId = null;

function tone(status) {
  return STATUS_META[status]?.tone || "slate";
}

function switchView(viewName) {
  sideLinks.forEach((button) => button.classList.toggle("active", button.dataset.view === viewName));
  views.forEach((view) => view.classList.toggle("active", view.dataset.view === viewName));
}

function renderOverview() {
  const metrics = getDashboardMetrics(state);
  document.getElementById("overviewMetrics").innerHTML = `
    <article class="metric-pill"><span>今日采集</span><strong>${metrics.todayCaptureCount}</strong></article>
    <article class="metric-pill"><span>高分商品</span><strong>${metrics.highScoreCount}</strong></article>
    <article class="metric-pill"><span>待上架</span><strong>${metrics.pendingListingCount}</strong></article>
    <article class="metric-pill"><span>已上架</span><strong>${metrics.listedCount}</strong></article>
  `;

  const maxCapture = Math.max(...metrics.trendDays.map((item) => item.captures || 0), 1);
  document.getElementById("trendBars").innerHTML = metrics.trendDays
    .map(
      (item) => `
        <div class="trend-row">
          <span class="mini-meta">${item.label}</span>
          <div class="trend-track"><div class="trend-fill" style="width:${(item.captures / maxCapture) * 100}%"></div></div>
          <span class="mini-meta">${item.captures}</span>
        </div>
      `
    )
    .join("");

  document.getElementById("categoryList").innerHTML =
    metrics.categoryDistribution
      .map(
        (item) => `
          <div class="progress-row">
            <div class="mini-meta">${escapeHtml(item.label)}</div>
            <div class="progress-track"><div class="progress-fill" style="width:${(item.count / Math.max(metrics.productCount, 1)) * 100}%"></div></div>
          </div>
        `
      )
      .join("") || `<div class="mini-meta">暂无类目数据</div>`;
}

function currentProducts() {
  const platform = document.getElementById("productPlatformFilter").value;
  const status = document.getElementById("productStatusFilter").value;
  const keyword = document.getElementById("productSearch").value.trim();

  return state.products.filter((product) => {
    if (platform && product.sourcePlatform !== platform) {
      return false;
    }
    if (status && product.status !== status) {
      return false;
    }
    if (keyword) {
      const haystack = `${product.productTitle} ${product.categoryName}`.toLowerCase();
      if (!haystack.includes(keyword.toLowerCase())) {
        return false;
      }
    }
    return true;
  });
}

function renderProducts() {
  const products = currentProducts();
  if (!selectedProductId && products[0]) {
    selectedProductId = products[0].id;
  }
  if (selectedProductId && !products.some((item) => item.id === selectedProductId)) {
    selectedProductId = products[0]?.id || null;
  }

  document.getElementById("productList").innerHTML =
    products
      .map(
        (product) => `
          <article class="list-item ${product.id === selectedProductId ? "title-option active" : ""}" data-product-id="${product.id}">
            <div class="badge-row">
              <span class="badge">${escapeHtml(titleCasePlatform(product.sourcePlatform))}</span>
              <span class="status-chip ${tone(product.status)}">${escapeHtml(product.status)}</span>
              <span class="badge">评分 ${product.scoreTotal || 0}</span>
            </div>
            <h3 class="product-title">${escapeHtml(product.productTitle)}</h3>
            <p class="mini-meta">利润 ${formatCurrency(product.estimatedProfit || 0)} / 利润率 ${formatPercent(product.estimatedProfitRate || 0)}</p>
            <p class="mini-meta">更新时间 ${formatDateTime(product.updatedAt)}</p>
          </article>
        `
      )
      .join("") || `<article class="section-card"><p class="hero-copy">还没有商品，先在插件里采集一个页面。</p></article>`;

  renderProductDetail();
}

function renderProductDetail() {
  const product = state.products.find((item) => item.id === selectedProductId);
  const panel = document.getElementById("productDetail");
  if (!product) {
    panel.innerHTML = `<p class="hero-copy">选中一个商品后，这里会展示详情、分析和操作。</p>`;
    return;
  }

  const generatedTitles = product.generated?.titles || [];
  panel.innerHTML = `
    <div class="section-header">
      <div>
        <p class="eyebrow">商品详情</p>
        <h3>${escapeHtml(product.productTitle)}</h3>
      </div>
      <span class="status-chip ${tone(product.status)}">${escapeHtml(product.status)}</span>
    </div>
    <div class="stack">
      <div class="mini-meta">平台：${escapeHtml(titleCasePlatform(product.sourcePlatform))}</div>
      <div class="mini-meta">来源：${escapeHtml(product.sourceUrl || "未记录")}</div>
      <div class="mini-meta">当前价：${formatCurrency(product.originalPrice)} / 建议价：${formatCurrency(product.suggestedPrice || product.originalPrice)}</div>
      <div class="mini-meta">综合评分：${product.scoreTotal || 0} / 风险等级：${escapeHtml(product.riskLevel || "medium")}</div>
      <div class="tag-row">${generatedTitles.slice(0, 3).map((title) => `<span class="tag">${escapeHtml(title)}</span>`).join("")}</div>
      <div class="button-row">
        <button class="secondary-button" data-action="create-draft" data-product-id="${product.id}">生成/更新草稿</button>
        <button class="ghost-button" data-action="mark-listed" data-product-id="${product.id}">标记已上架</button>
        <button class="ghost-button" data-action="mark-drop" data-product-id="${product.id}">移入淘汰</button>
        <button class="ghost-button" data-action="regen-content" data-product-id="${product.id}">重新生成内容</button>
        <button class="ghost-button" data-action="delete-product" data-product-id="${product.id}">删除商品</button>
      </div>
    </div>
  `;
}

function renderDrafts() {
  if (!selectedDraftId && state.drafts[0]) {
    selectedDraftId = state.drafts[0].id;
  }
  if (selectedDraftId && !state.drafts.some((item) => item.id === selectedDraftId)) {
    selectedDraftId = state.drafts[0]?.id || null;
  }

  document.getElementById("draftList").innerHTML =
    state.drafts
      .map(
        (draft) => `
          <article class="list-item ${draft.id === selectedDraftId ? "title-option active" : ""}" data-draft-id="${draft.id}">
            <div class="badge-row">
              <span class="badge">${escapeHtml(titleCasePlatform(draft.sourcePlatform))}</span>
              <span class="status-chip ${tone(draft.status === "已完成" ? "已上架" : "待上架")}">${escapeHtml(draft.status)}</span>
              <span class="badge">v${draft.versionNo}</span>
            </div>
            <h3 class="draft-title">${escapeHtml(draft.draftTitle)}</h3>
            <p class="mini-meta">建议售价 ${formatCurrency(draft.draftPrice)}</p>
            <p class="mini-meta">更新时间 ${formatDateTime(draft.updatedAt)}</p>
          </article>
        `
      )
      .join("") || `<article class="section-card"><p class="hero-copy">草稿箱暂时为空。先在插件页点击“保存草稿”。</p></article>`;

  renderDraftDetail();
}

function renderDraftDetail() {
  const draft = state.drafts.find((item) => item.id === selectedDraftId);
  const panel = document.getElementById("draftDetail");
  if (!draft) {
    panel.innerHTML = `<p class="hero-copy">选中一个草稿后，这里会展示标题、标签和复制操作。</p>`;
    return;
  }

  panel.innerHTML = `
    <div class="section-header">
      <div>
        <p class="eyebrow">草稿详情</p>
        <h3>${escapeHtml(draft.draftTitle)}</h3>
      </div>
      <span class="badge">v${draft.versionNo}</span>
    </div>
    <div class="stack">
      <div class="mini-meta">原商品：${escapeHtml(draft.productTitle)}</div>
      <div class="mini-meta">售价：${formatCurrency(draft.draftPrice)}</div>
      <div class="tag-row">${(draft.draftTags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
      <textarea id="draftEditor" class="copy-area">${escapeHtml(draft.draftDesc || "")}</textarea>
      <div class="button-row">
        <button class="secondary-button" data-action="copy-draft" data-draft-id="${draft.id}">复制整份草稿</button>
        <button class="ghost-button" data-action="save-draft-text" data-draft-id="${draft.id}">保存文案修改</button>
        <button class="ghost-button" data-action="complete-draft" data-draft-id="${draft.id}">标记已完成</button>
        <button class="ghost-button" data-action="delete-draft" data-draft-id="${draft.id}">删除草稿</button>
      </div>
    </div>
  `;
}

function bindViewEvents() {
  sideLinks.forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  document.getElementById("refreshDashboard").addEventListener("click", refreshState);

  ["productPlatformFilter", "productStatusFilter", "productSearch"].forEach((id) => {
    document.getElementById(id).addEventListener("input", renderProducts);
    document.getElementById(id).addEventListener("change", renderProducts);
  });

  document.getElementById("productList").addEventListener("click", (event) => {
    const item = event.target.closest("[data-product-id]");
    if (!item) {
      return;
    }
    selectedProductId = item.dataset.productId;
    renderProducts();
  });

  document.getElementById("draftList").addEventListener("click", (event) => {
    const item = event.target.closest("[data-draft-id]");
    if (!item) {
      return;
    }
    selectedDraftId = item.dataset.draftId;
    renderDrafts();
  });

  document.getElementById("productDetail").addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) {
      return;
    }
    const productId = action.dataset.productId;

    if (action.dataset.action === "mark-listed") {
      await updateProductStatus(productId, "已上架");
      await refreshState();
      return;
    }
    if (action.dataset.action === "mark-drop") {
      await updateProductStatus(productId, "已淘汰");
      await refreshState();
      return;
    }
    if (action.dataset.action === "create-draft") {
      await createOrUpdateDraftFromProduct(productId);
      await refreshState();
      switchView("drafts");
      return;
    }
    if (action.dataset.action === "regen-content") {
      const product = state.products.find((item) => item.id === productId);
      if (!product?.analysis) {
        return;
      }
      const regenerated = generateContentPackage(product, product.analysis);
      await saveProductGeneration(productId, regenerated);
      await refreshState();
      return;
    }
    if (action.dataset.action === "delete-product") {
      await deleteProduct(productId);
      await refreshState();
    }
  });

  document.getElementById("draftDetail").addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) {
      return;
    }
    const draftId = action.dataset.draftId;
    const draft = state.drafts.find((item) => item.id === draftId);
    if (!draft) {
      return;
    }

    if (action.dataset.action === "copy-draft") {
      await navigator.clipboard.writeText(buildCopyBundle(draft));
      return;
    }
    if (action.dataset.action === "save-draft-text") {
      const draftEditor = document.getElementById("draftEditor");
      await updateDraft(draftId, { draftDesc: draftEditor.value });
      await refreshState();
      return;
    }
    if (action.dataset.action === "complete-draft") {
      await updateDraft(draftId, { status: "已完成" });
      await updateProductStatus(draft.productId, "已上架");
      await refreshState();
      return;
    }
    if (action.dataset.action === "delete-draft") {
      await deleteDraft(draftId);
      await refreshState();
    }
  });
}

async function refreshState() {
  state = await getState();
  renderOverview();
  renderProducts();
  renderDrafts();
}

async function boot() {
  await initState();
  bindViewEvents();
  await refreshState();
}

boot();
