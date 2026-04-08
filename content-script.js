(function () {
  const PLATFORM_RULES = [
    { key: "xianyu", test: /goofish/i },
    { key: "1688", test: /1688/i },
    { key: "pinduoduo", test: /(yangkeduo|pinduoduo)/i },
    { key: "taobao", test: /taobao/i }
  ];

  function detectPlatform(hostname) {
    const matched = PLATFORM_RULES.find((rule) => rule.test.test(hostname));
    return matched ? matched.key : null;
  }

  function textFromSelectors(selectors) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const text = node?.textContent?.trim();
      if (text) {
        return text;
      }
    }
    return "";
  }

  function meta(name, attr = "content") {
    return document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute(attr) || "";
  }

  function isXianyuDetailPage(pathname = location.pathname) {
    return /^\/item(?:\/|$)/i.test(pathname || "");
  }

  function toNumber(value) {
    if (!value) {
      return 0;
    }
    const match = String(value).replace(/[,，]/g, "").match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
  }

  function extractJsonLd() {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const script of scripts) {
      try {
        const parsed = JSON.parse(script.textContent);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        const product = items.find((item) => item["@type"] === "Product" || item?.["@graph"]?.some?.((entry) => entry["@type"] === "Product"));
        if (product) {
          return product["@graph"]?.find?.((entry) => entry["@type"] === "Product") || product;
        }
      } catch (error) {
        continue;
      }
    }
    return null;
  }

  function collectImages(jsonLd) {
    const fromJsonLd = [];
    if (Array.isArray(jsonLd?.image)) {
      fromJsonLd.push(...jsonLd.image);
    } else if (typeof jsonLd?.image === "string") {
      fromJsonLd.push(jsonLd.image);
    }
    const domImages = Array.from(document.images)
      .map((image) => image.currentSrc || image.src)
      .filter((src) => src && !src.startsWith("data:"))
      .slice(0, 6);
    const metaImages = [meta("og:image"), meta("twitter:image")].filter(Boolean);
    return Array.from(new Set([...fromJsonLd, ...metaImages, ...domImages])).slice(0, 8);
  }

  function findKeywordValue(keywords) {
    const bodyText = document.body?.innerText || "";
    const lines = bodyText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const line = lines.find((item) => keywords.some((keyword) => item.includes(keyword)));
    return line || "";
  }

  function parsePage() {
    const platform = detectPlatform(location.hostname);
    if (!platform) {
      return {
        supported: false,
        hostname: location.hostname,
        url: location.href,
        reason: "当前页面暂不支持解析"
      };
    }

    if (platform === "xianyu" && !isXianyuDetailPage()) {
      return {
        supported: true,
        canCollect: false,
        isDetailPage: false,
        platform,
        hostname: location.hostname,
        url: location.href,
        reason: "当前是闲鱼浏览页，请进入商品详情页后再采集。"
      };
    }

    const jsonLd = extractJsonLd();
    const title = (
      jsonLd?.name ||
      textFromSelectors([
        "h1",
        '[data-testid*="title"]',
        '[class*="title"]',
        '[class*="Title"]',
        '[class*="name"]'
      ]) ||
      meta("og:title") ||
      document.title
    ).trim();

    const priceText =
      jsonLd?.offers?.price ||
      textFromSelectors([
        '[class*="price"]',
        '[class*="Price"]',
        '[data-testid*="price"]',
        '[class*="amount"]',
        '[class*="Amount"]'
      ]) ||
      meta("product:price:amount");

    const description =
      jsonLd?.description ||
      meta("og:description") ||
      textFromSelectors([
        '[class*="desc"]',
        '[class*="Desc"]',
        '[class*="detail"]',
        '[class*="Detail"]'
      ]);

    const skuSummary = findKeywordValue(["规格", "SKU", "颜色", "尺寸", "套餐", "款式"]);
    const locationText = findKeywordValue(["发货地", "所在地", "收货地", "仓库"]);
    const salesText = findKeywordValue(["已售", "销量", "人付款", "成交"]);
    const ratingText = findKeywordValue(["评价", "评论"]);

    const supported = Boolean(title);

    return {
      supported,
      canCollect: supported,
      isDetailPage: true,
      platform,
      hostname: location.hostname,
      url: location.href,
      title,
      price: toNumber(priceText),
      couponPrice: 0,
      description,
      skuSummary,
      location: locationText,
      sales: toNumber(salesText),
      ratingCount: toNumber(ratingText),
      images: collectImages(jsonLd),
      reason: supported ? "" : "当前页面暂未识别到商品信息，请确认已进入商品详情页后重试。"
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "FH_PARSE_PRODUCT") {
      return undefined;
    }

    try {
      sendResponse({
        ok: true,
        payload: parsePage()
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error?.message || "解析失败"
      });
    }

    return true;
  });
})();
