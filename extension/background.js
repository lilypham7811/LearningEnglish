// Right-click "Save to LearningEnglish": captures the page (YouTube video or news article)
// and hands it to the app through app-bridge.js. Uses an open app tab (online or local), else opens the online app.
const APP = "https://lilypham7811.github.io/LearningEnglish/";
const APP_URLS = [APP + "*", "http://localhost:8000/*"];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "save-page", title: "Save to LearningEnglish", contexts: ["page", "selection", "video", "image", "frame"] });
  chrome.contextMenus.create({ id: "save-link", title: "Save link to LearningEnglish", contexts: ["link"] });
});

chrome.contextMenus.onClicked.addListener((info, tab) =>
  save(tab, info.menuItemId === "save-link" ? info.linkUrl : null, info.selectionText));
chrome.action.onClicked.addListener((tab) => save(tab, null, null));

async function save(tab, linkUrl, selection) {
  if (tab?.url?.startsWith(APP) || tab?.url?.startsWith("http://localhost:8000/")) return;
  let item = linkUrl ? { url: linkUrl } : await capture(tab);
  // A long selection is the article text the user wants (useful on messy pages).
  if (!linkUrl && selection && selection.length > 300) item = { ...item, text: selection };
  const { queue = [] } = await chrome.storage.local.get("queue");
  queue.push(item);
  await chrome.storage.local.set({ queue });
  if (tab?.id) {
    chrome.action.setBadgeBackgroundColor({ color: "#2D6A4D", tabId: tab.id });
    chrome.action.setBadgeText({ text: "✓", tabId: tab.id });
    setTimeout(() => chrome.action.setBadgeText({ text: "", tabId: tab.id }), 2500);
  }
  await deliver();
}

async function capture(tab) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: grabPage });
    return result;
  } catch {
    return { url: tab.url, title: tab.title }; // pages the extension can't read (e.g. browser pages)
  }
}

// Runs inside the saved page.
function grabPage() {
  const meta = (p) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.content || "";
  if (/(^|\.)youtube\.com$/.test(location.hostname)) {
    return {
      url: location.href,
      title: (document.querySelector("h1.ytd-watch-metadata, #title h1")?.textContent || document.title.replace(/ - YouTube$/, "")).trim(),
      channel: (document.querySelector("#owner #channel-name a, ytd-video-owner-renderer #channel-name a")?.textContent || "").trim(),
    };
  }
  const root = document.querySelector("article") || document.querySelector("main") || document.body;
  const paras = [...root.querySelectorAll("p")].map((p) => p.innerText.trim()).filter((t) => t.split(/\s+/).length >= 8);
  const text = paras.length >= 3 ? paras.join("\n\n") : root.innerText;
  return {
    url: location.href,
    title: (meta("og:title") || document.title).trim(),
    site: meta("og:site_name") || location.hostname.replace(/^www\./, ""),
    image: meta("og:image"),
    excerpt: meta("og:description") || meta("description"),
    text: text.slice(0, 40000),
  };
}

// Bring the app forward and ask its bridge to pick up the queue (a newly opened app picks it up on load).
async function deliver() {
  const [tab] = await chrome.tabs.query({ url: APP_URLS });
  if (!tab) { await chrome.tabs.create({ url: APP }); return; }
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  try { await chrome.tabs.sendMessage(tab.id, { type: "flush" }); }
  catch { await chrome.tabs.reload(tab.id); }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "take-queue") return;
  chrome.storage.local.get("queue").then(async ({ queue = [] }) => {
    await chrome.storage.local.set({ queue: [] });
    sendResponse(queue);
  });
  return true; // async response
});
