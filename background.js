const DEFAULT_ENGINES = [
  {
    name: "Google",
    template: "https://www.google.com/search?q=%s"
  },
  {
    name: "Bing",
    template: "https://www.bing.com/search?q=%s"
  },
  {
    name: "DuckDuckGo",
    template: "https://duckduckgo.com/?q=%s"
  },
  {
    name: "Wikipedia",
    template: "https://en.wikipedia.org/wiki/Special:Search?search=%s"
  }
];

async function getEngines() {
  const result = await chrome.storage.sync.get("engines");
  if (!Array.isArray(result.engines) || result.engines.length === 0) {
    await chrome.storage.sync.set({ engines: DEFAULT_ENGINES });
    return DEFAULT_ENGINES;
  }
  return result.engines;
}

let rebuildInFlight = false;
let rebuildPending = false;

function rebuildMenus() {
  if (rebuildInFlight) {
    rebuildPending = true;
    return;
  }
  rebuildInFlight = true;
  chrome.contextMenus.removeAll(() => {
    getEngines()
      .then((engines) => {
        engines.forEach((engine, index) => {
          if (!engine || !engine.name || !engine.template) return;
          chrome.contextMenus.create(
            {
              id: `engine-${index}`,
              title: `${index + 1}. ${engine.name}`,
              contexts: ["selection"]
            },
            () => {
              // Ignore duplicate id errors if they happen.
              void chrome.runtime.lastError;
            }
          );
        });
      })
      .finally(() => {
        rebuildInFlight = false;
        if (rebuildPending) {
          rebuildPending = false;
          rebuildMenus();
        }
      });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  rebuildMenus();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.engines) {
    rebuildMenus();
  }
});

async function openNextToTab(tabId, url) {
  try {
    const tab = await chrome.tabs.get(tabId);
    chrome.tabs.create({
      url,
      index: tab.index + 1,
      openerTabId: tab.id
    });
  } catch (err) {
    chrome.tabs.create({ url });
  }
}

async function openAtEnd(url) {
  chrome.tabs.create({ url });
}

async function openWithPreference(tabId, url) {
  const result = await chrome.storage.sync.get(["settings"]);
  const position = result.settings?.tabPosition || "next";
  if (position === "end") {
    return openAtEnd(url);
  }
  return openNextToTab(tabId, url);
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

chrome.contextMenus.onClicked.addListener((info) => {
  if (!info.selectionText) return;
  const menuId = String(info.menuItemId || "");
  if (!menuId.startsWith("engine-")) return;

  const index = Number(menuId.slice("engine-".length));
  getEngines().then((engines) => {
    const engine = engines[index];
    if (!engine || !engine.template) return;
    const url = buildSearchOrDirectUrl(info.selectionText, engine);
    openWithPreference(info.tabId, url);
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== "open-url" || !message.url) return;
  if (sender && sender.tab && sender.tab.id != null) {
    openWithPreference(sender.tab.id, message.url);
  } else {
    chrome.tabs.create({ url: message.url });
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "open-options") return;
  chrome.runtime.openOptionsPage();
});
