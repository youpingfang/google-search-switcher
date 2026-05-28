let enginesCache = [];
let maxButtons = 3;
let floatEl = null;
let lastSelection = "";
let dropdownEl = null;
let uiLang = "zh";
let translateProvider = "google";
let floatTimeoutMs = 5000;
let hideTimer = null;
const RETURN_TIMEOUT_MS = 3000;
const DEFAULT_FLOAT_ORDER = ["copy", "translate"];
let floatOrder = DEFAULT_FLOAT_ORDER.slice();
let floatDragging = null;
let floatDropBefore = null;
let selectionTimer = null;
let lastRenderedSelection = "";
let isPointerSelecting = false;

const LABELS = {
  zh: {
    copy: "复制",
    more: "更多",
    settings: "设置",
    translate: "翻译",
    translate_back: "原页面"
  },
  en: {
    copy: "Copy",
    more: "More",
    settings: "Settings",
    translate: "Translate Page",
    translate_back: "Original Page"
  }
};

function t(key) {
  return (LABELS[uiLang] && LABELS[uiLang][key]) || LABELS.zh[key];
}

function getTopEngines() {
  return enginesCache.slice(0, maxButtons);
}

function getDirectUrl(text) {
  const value = String(text || "").trim();
  if (!value || /\s/.test(value)) return null;

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
  const candidate = withProtocol ? value : `https://${value}`;

  if (!withProtocol) {
    const hostPart = value.split(/[/?#]/, 1)[0].split(":", 1)[0];
    const domainLike =
      hostPart === "localhost" ||
      /^(\d{1,3}\.){3}\d{1,3}$/.test(hostPart) ||
      /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(hostPart);
    if (!domainLike) return null;
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch (err) {
    return null;
  }
}

function buildSearchOrDirectUrl(text, engine) {
  const directUrl = getDirectUrl(text);
  if (directUrl) return directUrl;
  const query = encodeURIComponent(text);
  return engine.template.replace(/%s/g, query);
}

function normalizeFloatOrder(order) {
  const items = ["copy", "translate", "engines", "more"];
  const result = [];
  const seen = new Set();
  let hasEngineItems = false;
  (order || []).forEach((item) => {
    if (typeof item !== "string") return;
    if (item.startsWith("engine:")) {
      if (seen.has(item)) return;
      seen.add(item);
      result.push(item);
      hasEngineItems = true;
      return;
    }
    if (!items.includes(item)) return;
    if (seen.has(item)) return;
    seen.add(item);
    result.push(item);
  });
  if (!hasEngineItems && !seen.has("engines")) {
    result.push("engines");
    seen.add("engines");
  }
  items.forEach((item) => {
    if (item === "more") return;
    if (!seen.has(item)) result.push(item);
  });
  return result;
}

function getEngineId(index) {
  return `engine:${index}`;
}

function getEngineIndex(orderId) {
  if (typeof orderId !== "string" || !orderId.startsWith("engine:")) return null;
  const idx = Number(orderId.slice("engine:".length));
  if (!Number.isFinite(idx) || idx < 0 || idx >= enginesCache.length) return null;
  return idx;
}

function getOrderedEngineIds(order = floatOrder) {
  const result = [];
  const seen = new Set();
  normalizeFloatOrder(order).forEach((item) => {
    const idx = getEngineIndex(item);
    if (idx == null) return;
    const id = getEngineId(idx);
    if (seen.has(id)) return;
    seen.add(id);
    result.push(id);
  });
  enginesCache.forEach((_, idx) => {
    const id = getEngineId(idx);
    if (seen.has(id)) return;
    seen.add(id);
    result.push(id);
  });
  return result;
}

function getExpandedFloatOrder(order = floatOrder) {
  const result = [];
  const seen = new Set();
  normalizeFloatOrder(order).forEach((item) => {
    if (item === "engines") {
      getOrderedEngineIds(order).forEach((id) => {
        if (seen.has(id)) return;
        seen.add(id);
        result.push(id);
      });
      return;
    }
    if (item === "more") return;
    const idx = getEngineIndex(item);
    const normalized = idx == null ? item : getEngineId(idx);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });
  getOrderedEngineIds(order).forEach((id) => {
    if (seen.has(id)) return;
    seen.add(id);
    result.push(id);
  });
  return result;
}

function canShowEngine(orderId, renderedEngines) {
  const idx = getEngineIndex(orderId);
  return idx != null && !renderedEngines.has(idx) && renderedEngines.size < maxButtons;
}


function getFloatAfterElement(container, x) {
  const items = [...container.children].filter(
    (child) =>
      child instanceof HTMLElement &&
      child.dataset.orderId &&
      child !== floatDragging
  );
  return items.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = x - box.left - box.width / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

function persistFloatOrder(order) {
  floatOrder = normalizeFloatOrder(order);
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.sync) return;
  chrome.storage.sync.get(["settings"], (result) => {
    const settings = (result && result.settings) || {};
    chrome.storage.sync.set({ settings: { ...settings, floatOrder } });
  });
}

async function loadEngines() {
  const result = await chrome.storage.sync.get(["engines", "settings"]);
  const engines = Array.isArray(result.engines) ? result.engines : [];
  const settings = result.settings || {};
  maxButtons = Number.isFinite(settings.maxButtons) ? settings.maxButtons : 3;
  if (maxButtons < 1) maxButtons = 1;
      window.__mesFloatPosition = settings.floatPosition || "top";
      uiLang = settings.lang || "zh";
      translateProvider = settings.translateProvider || "google";
      floatOrder = normalizeFloatOrder(settings.floatOrder || DEFAULT_FLOAT_ORDER);
  const timeoutSec = Number.isFinite(settings.floatTimeout) ? settings.floatTimeout : 5;
  floatTimeoutMs = Math.max(1000, timeoutSec * 1000);
  enginesCache = engines.filter((e) => e && e.name && e.template);
}

function createFloat() {
  const el = document.createElement("div");
  el.className = "mes-float";
  el.style.display = "none";
  el.addEventListener("mouseenter", () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  });
  el.addEventListener("mouseleave", () => {
    startHideTimer();
  });
  document.body.appendChild(el);
  return el;
}

function clearFloat() {
  if (!floatEl) return;
  floatEl.style.display = "none";
  floatEl.innerHTML = "";
  dropdownEl = null;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function startHideTimer(timeoutMs = floatTimeoutMs) {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    clearFloat();
  }, timeoutMs);
}

function renderButtons(selectionText) {
  if (!floatEl) floatEl = createFloat();
  floatEl.innerHTML = "";
  const engines = getTopEngines();
  const renderedEngines = new Set();

  const appendCopy = () => {
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = t("copy");
    copyBtn.setAttribute("draggable", "true");
    copyBtn.dataset.orderId = "copy";
    copyBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(selectionText);
      } catch (err) {
        const textarea = document.createElement("textarea");
        textarea.value = selectionText;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      clearFloat();
    });
    floatEl.appendChild(copyBtn);
  };

  const appendEngines = () => {
    engines.forEach((engine, idx) => {
      if (renderedEngines.has(idx)) return;
      if (renderedEngines.size >= maxButtons) return;
      renderedEngines.add(idx);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = engine.name;
      btn.setAttribute("draggable", "true");
      btn.dataset.orderId = `engine:${idx}`;
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const url = buildSearchOrDirectUrl(selectionText, engine);
        chrome.runtime.sendMessage({ type: "open-url", url });
      });
      floatEl.appendChild(btn);
    });
  };

  const appendTranslate = () => {
    const translateBtn = document.createElement("button");
    translateBtn.type = "button";
    translateBtn.textContent = t("translate");
    translateBtn.setAttribute("draggable", "true");
    translateBtn.dataset.orderId = "translate";
    translateBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const query = encodeURIComponent(selectionText);
      const hasCJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(selectionText);
      const targetLang = hasCJK ? "en" : "zh-CN";
      let url = "";
      if (translateProvider === "baidu") {
        url = `https://fanyi.baidu.com/#auto/${encodeURIComponent(targetLang)}/${query}`;
      } else if (translateProvider === "bing") {
        url = `https://www.bing.com/translator?from=auto&to=${encodeURIComponent(targetLang)}&text=${query}`;
      } else {
        url = `https://translate.google.com/?sl=auto&tl=${encodeURIComponent(targetLang)}&text=${query}&op=translate`;
      }
      chrome.runtime.sendMessage({ type: "open-url", url });
    });
    floatEl.appendChild(translateBtn);
  };

  const appendMore = () => {
    const remaining = getOrderedEngineIds()
      .map((id) => {
        const idx = getEngineIndex(id);
        return idx == null ? null : { engine: enginesCache[idx], idx };
      })
      .filter(Boolean)
      .filter(({ idx }) => !renderedEngines.has(idx));
    if (!remaining.length) return;
    const moreWrap = document.createElement("div");
    moreWrap.className = "mes-more";
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.textContent = t("more");
    moreBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (dropdownEl) {
        dropdownEl.classList.toggle("open");
        return;
      }
      dropdownEl = document.createElement("div");
      dropdownEl.className = "mes-dropdown open";

      remaining.forEach(({ engine, idx }) => {
        const item = document.createElement("button");
        item.type = "button";
        item.textContent = engine.name;
        item.setAttribute("draggable", "true");
        item.dataset.orderId = `engine:${idx}`;
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          const url = buildSearchOrDirectUrl(selectionText, engine);
          chrome.runtime.sendMessage({ type: "open-url", url });
        });
        dropdownEl.appendChild(item);
      });

      const divider = document.createElement("div");
      divider.className = "mes-divider";
      dropdownEl.appendChild(divider);

      const settingsBtn = document.createElement("button");
      settingsBtn.type = "button";
      settingsBtn.textContent = t("settings");
      settingsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ type: "open-options" });
      });
      dropdownEl.appendChild(settingsBtn);

      moreWrap.appendChild(dropdownEl);
    });
    moreWrap.appendChild(moreBtn);
    floatEl.appendChild(moreWrap);
  };


  normalizeFloatOrder(floatOrder).forEach((item) => {
    if (item === "copy") appendCopy();
    if (item === "translate") appendTranslate();
    if (item === "engines") appendEngines();
    if (typeof item === "string" && item.startsWith("engine:")) {
      const idx = Number(item.slice("engine:".length));
      if (!canShowEngine(item, renderedEngines)) return;
      const engine = enginesCache[idx];
      if (!engine) return;
      renderedEngines.add(idx);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = engine.name;
      btn.setAttribute("draggable", "true");
      btn.dataset.orderId = `engine:${idx}`;
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const url = buildSearchOrDirectUrl(selectionText, engine);
        chrome.runtime.sendMessage({ type: "open-url", url });
      });
      floatEl.appendChild(btn);
    }
  });
  appendMore();

  if (floatEl && !floatEl.dataset.dragReady) {
    floatEl.dataset.dragReady = "1";
    floatEl.addEventListener("dragstart", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.dataset.orderId) return;
      floatDragging = target;
      floatDropBefore = null;
      target.classList.add("mes-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", "");
    });

    floatEl.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (!floatDragging) return;
      event.dataTransfer.dropEffect = "move";
      floatDropBefore = getFloatAfterElement(floatEl, event.clientX);
    });

    floatEl.addEventListener("drop", (event) => {
      event.preventDefault();
      const target = event.target;
      if (target instanceof HTMLElement && target.closest(".mes-dropdown")) {
        return;
      }
      if (!floatDragging || !floatDragging.dataset.orderId) return;

      const draggingId = floatDragging.dataset.orderId;
      const beforeId = floatDropBefore?.dataset.orderId || null;
      const order = getExpandedFloatOrder().filter((id) => id !== draggingId);
      const visibleOrder = Array.from(floatEl.children)
        .filter((el) => el instanceof HTMLElement && el.dataset.orderId)
        .map((el) => el.dataset.orderId)
        .filter((id) => id && id !== draggingId);
      const visibleEngineOrder = visibleOrder.filter((id) => getEngineIndex(id) != null);
      const isHiddenEngine =
        getEngineIndex(draggingId) != null && floatDragging.parentElement !== floatEl;

      let insertIndex = order.length;
      if (beforeId && order.includes(beforeId)) {
        insertIndex = order.indexOf(beforeId);
      } else if (visibleOrder.length) {
        const lastVisibleId = visibleOrder[visibleOrder.length - 1];
        insertIndex = order.includes(lastVisibleId)
          ? order.indexOf(lastVisibleId) + 1
          : order.length;
      }

      if (isHiddenEngine && visibleEngineOrder.length >= maxButtons) {
        const lastVisibleEngineId = visibleEngineOrder[visibleEngineOrder.length - 1];
        const lastVisibleEngineIndex = order.indexOf(lastVisibleEngineId);
        if (lastVisibleEngineIndex >= 0 && insertIndex > lastVisibleEngineIndex) {
          insertIndex = lastVisibleEngineIndex;
        }
      }

      order.splice(insertIndex, 0, draggingId);
      persistFloatOrder(order);
      renderButtons(selectionText);
      floatEl.style.display = "flex";
    });

    floatEl.addEventListener("dragend", () => {
      if (!floatDragging) return;
      floatDragging.classList.remove("mes-dragging");
      floatDragging = null;
      floatDropBefore = null;
    });
  }
}


function positionFloat(rect) {
  if (!floatEl) return;
  const padding = 16;
  const floatWidth = floatEl.offsetWidth;
  const floatHeight = floatEl.offsetHeight;
  const viewportBottom = window.scrollY + window.innerHeight;

  const prefer = window.__mesFloatPosition || "top";
  let top = prefer === "bottom"
    ? window.scrollY + rect.bottom + padding
    : window.scrollY + rect.top - floatHeight - padding;
  if (prefer === "bottom" && top + floatHeight > viewportBottom - padding) {
    top = window.scrollY + rect.top - floatHeight - padding;
  } else if (prefer === "top" && top < window.scrollY + padding) {
    top = window.scrollY + rect.bottom + padding;
  }
  top = Math.min(top, viewportBottom - floatHeight - padding);

  let left = window.scrollX + rect.left;
  const viewportRight = window.scrollX + window.innerWidth;
  if (left + floatWidth > viewportRight - padding) {
    left = viewportRight - floatWidth - padding;
  }
  left = Math.max(left, window.scrollX + padding);

  floatEl.style.top = `${top}px`;
  floatEl.style.left = `${left}px`;
}

function getSelectionRect(selection) {
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) return rect;

  const rects = Array.from(range.getClientRects()).filter(
    (item) => item.width > 0 || item.height > 0
  );
  if (!rects.length) return null;
  return rects[rects.length - 1];
}

function scheduleSelectionCheck(delay = 80) {
  if (selectionTimer) clearTimeout(selectionTimer);
  selectionTimer = setTimeout(() => {
    selectionTimer = null;
    handleSelection();
  }, delay);
}

function handleSelection() {
  if (isPointerSelecting) return;
  if (floatDragging) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    lastSelection = "";
    lastRenderedSelection = "";
    clearFloat();
    return;
  }

  const text = selection.toString().trim();
  if (!text) {
    lastSelection = "";
    lastRenderedSelection = "";
    clearFloat();
    return;
  }

  const rect = getSelectionRect(selection);
  if (!rect) {
    return;
  }

  lastSelection = text;
  if (lastRenderedSelection !== text || !floatEl || floatEl.style.display !== "flex") {
    renderButtons(text);
    lastRenderedSelection = text;
  }
  floatEl.style.display = "flex";
  positionFloat(rect);

  startHideTimer();
}

function isFloatEventTarget(target) {
  return target instanceof Node && floatEl && floatEl.contains(target);
}

function handlePointerStart(event) {
  if (isFloatEventTarget(event.target)) return;
  isPointerSelecting = true;
  if (!window.getSelection()?.isCollapsed && lastSelection) return;
  lastRenderedSelection = "";
  clearFloat();
}

function handlePointerEnd(event) {
  if (isFloatEventTarget(event.target)) return;
  isPointerSelecting = false;
  scheduleSelectionCheck(30);
}

window.addEventListener("mouseup", handlePointerEnd, true);
window.addEventListener("pointerup", handlePointerEnd, true);
window.addEventListener("pointercancel", () => {
  isPointerSelecting = false;
}, true);

document.addEventListener("mouseup", (event) => {
  if (floatEl && floatEl.contains(event.target)) return;
  isPointerSelecting = false;
  scheduleSelectionCheck(30);
});

document.addEventListener("scroll", () => {
  clearFloat();
});

window.addEventListener("mousedown", handlePointerStart, true);
window.addEventListener("pointerdown", handlePointerStart, true);

document.addEventListener("selectionchange", () => {
  scheduleSelectionCheck(120);
});

document.addEventListener("keyup", (event) => {
  const selectionKey =
    event.key.startsWith("Arrow") ||
    event.key === "Shift" ||
    event.key === "Meta" ||
    event.key === "Control";
  if (selectionKey) {
    scheduleSelectionCheck(30);
  }
});

document.addEventListener("touchend", () => {
  isPointerSelecting = false;
  scheduleSelectionCheck(120);
});

document.addEventListener("touchstart", (event) => {
  if (floatEl && floatEl.contains(event.target)) return;
  isPointerSelecting = true;
});

window.addEventListener("blur", () => {
  isPointerSelecting = false;
});

document.addEventListener("mousemove", (event) => {
  if (floatEl && floatEl.contains(event.target)) {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && floatEl && floatEl.style.display === "flex") {
    startHideTimer(RETURN_TIMEOUT_MS);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && (changes.engines || changes.settings)) {
    loadEngines();
  }
});

loadEngines();
