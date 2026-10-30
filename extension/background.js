// Right-click "Save to LearningEnglish" (the only way to save): captures the page (YouTube video or news article)
// and hands it to the online app (https://lilypham7811.github.io/LearningEnglish/) by opening it with #add=….
// Only the online app: it is the one on every device and the one that syncs with the phone.
const APP = "https://lilypham7811.github.io/LearningEnglish/";
const APP_URLS = [APP + "*"];

// The menu: "Save … to LearningEnglish" (your app), and for each person added in the options page
// ("📨 Gửi bài cho người khác") "📨 Gửi … cho <name>": straight into that person's app (their GitHub inbox).
async function buildMenus() {
  const { recipients = [] } = await chrome.storage.local.get("recipients");
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: "save-page", title: "Save this page to LearningEnglish", contexts: ["page", "video"] });
  chrome.contextMenus.create({ id: "save-link", title: "Save link to LearningEnglish", contexts: ["link"] });
  chrome.contextMenus.create({ id: "save-word", title: "Save word “%s” to LearningEnglish", contexts: ["selection"] });
  recipients.forEach((r, i) => {
    chrome.contextMenus.create({ id: `send:${i}:page`, title: `📨 Gửi trang này cho ${r.name}`, contexts: ["page", "video"] });
    chrome.contextMenus.create({ id: `send:${i}:link`, title: `📨 Gửi link cho ${r.name}`, contexts: ["link"] });
    chrome.contextMenus.create({ id: `send:${i}:word`, title: `📨 Gửi từ “%s” cho ${r.name}`, contexts: ["selection"] });
  });
  chrome.contextMenus.create({ id: "options", title: "📨 Thêm người nhận…", contexts: ["action"] });
}
chrome.runtime.onInstalled.addListener(buildMenus);
chrome.runtime.onStartup.addListener(buildMenus);
chrome.storage.onChanged.addListener((c) => { if (c.recipients) buildMenus(); });

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "options") return chrome.runtime.openOptionsPage();
  const [kind, i, what] = String(info.menuItemId).split(":");
  if (kind === "send") {
    const { recipients = [] } = await chrome.storage.local.get("recipients");
    const r = recipients[+i];
    if (!r) return;
    const item = what === "word" ? await wordItem(tab, info) : await pageItem(tab, what === "link" ? info.linkUrl : null, info.selectionText);
    if (!item) return refuse(tab);
    return sendTo(r, item, tab);
  }
  if (info.menuItemId === "save-word") return saveWord(tab, info);
  save(tab, info.menuItemId === "save-link" ? info.linkUrl : null, info.selectionText);
});

// A selected word (YouTube or eJOY subtitles, an article…) goes to the app's word list,
// with its sentence and, for videos, a link back to that second.
async function saveWord(tab, info) {
  await queue(await wordItem(tab, info), tab);
}
async function wordItem(tab, info) {
  let found = {};
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [info.frameId || 0] }, func: grabWord });
    found = result || {};
  } catch { /* frame we can't read: save the word alone */ }
  const url = found.url || info.frameUrl || info.pageUrl || "";
  const id = (url.match(/(?:v=|embed\/|shorts\/|youtu\.be\/)([\w-]{11})/) || [])[1];
  const t = found.time != null ? Math.floor(found.time) : null;
  return {
    kind: "word",
    word: info.selectionText.trim().slice(0, 60),
    context: found.context || "",
    sourceKind: id ? "video" : "article",
    sourceTitle: found.title || tab.title || "",
    sourceUrl: id ? `https://www.youtube.com/watch?v=${id}${t != null ? `&t=${t}s` : ""}` : url,
    time: t,
  };
}
function grabWord() {
  const sel = getSelection();
  let el = sel.anchorNode?.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
  let context = "";
  for (let n = el; n && n !== document.body; n = n.parentElement) { // smallest block holding a whole sentence
    const t = (n.innerText || "").replace(/\s+/g, " ").trim();
    if (t.length >= 15) { context = t.slice(0, 400); break; }
  }
  const v = document.querySelector("video");
  return { context, url: location.href, time: v ? v.currentTime : null,
    title: (document.querySelector("h1.ytd-watch-metadata")?.textContent || document.title.replace(/ - YouTube$/, "")).trim() };
}
// Saving happens ONLY from the right-click menu. The toolbar icon just opens the app, and there is no
// keyboard shortcut: Alt+Shift (switching Vietnamese / English keyboard) + S (Telex tone mark) used to
// trigger the old Alt+Shift+S shortcut and save pages by accident.
chrome.action.onClicked.addListener(async () => {
  const [tab] = await chrome.tabs.query({ url: APP_URLS });
  if (tab) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); }
  else await chrome.tabs.create({ url: APP });
});

// Pages that are never a news article or video: the app itself, browser pages and new-tab pages
// (including new-tab pages replaced by other extensions or sites).
function notSavable(tab) {
  const url = tab?.url || "";
  return url.startsWith(APP) || url.startsWith("http://localhost:8000/") ||
    /^(chrome|edge|about|chrome-extension|moz-extension):/.test(url) ||
    /^https?:\/\/([^/]+\.)?(claude\.ai|chatgpt\.com|chat\.openai\.com|gemini\.google\.com|aistudio\.google\.com|copilot\.microsoft\.com|perplexity\.ai|mail\.google\.com|outlook\.(live|office)\.com|mail\.yahoo\.com|messenger\.com|web\.whatsapp\.com|chat\.zalo\.me|zalo\.me|web\.telegram\.org|discord\.com|docs\.google\.com|drive\.google\.com|accounts\.google\.com|myaccount\.google\.com|onedrive\.live\.com|icloud\.com|notion\.so)(\/|$)/i.test(url) || // private pages: AI chats, mail, messages, documents
    /^(new tab|thẻ mới|trang mới|neuer tab|nouvel onglet)$/i.test((tab?.title || "").trim());
}
function refuse(tab) {
  if (!tab?.id) return;
  chrome.action.setBadgeBackgroundColor({ color: "#B23A28", tabId: tab.id });
  chrome.action.setBadgeText({ text: "✕", tabId: tab.id });
  setTimeout(() => chrome.action.setBadgeText({ text: "", tabId: tab.id }), 2500);
}

async function save(tab, linkUrl, selection) {
  const item = await pageItem(tab, linkUrl, selection);
  if (!item) return refuse(tab);
  await queue(item, tab);
}
async function pageItem(tab, linkUrl, selection) {
  if (!linkUrl && notSavable(tab)) return null;
  let item = linkUrl ? { url: linkUrl } : await capture(tab);
  // A long selection is the article text the user wants (useful on messy pages).
  if (!linkUrl && selection && selection.length > 300) item = { ...item, text: selection };
  return item;
}

// 📨 Into the other person's GitHub repo, as one small file in inbox/. Their app reads the inbox when it
// syncs, adds the items to their own lists and empties it. Their data never touches yours.
async function sendTo(r, item, tab) {
  const json = JSON.stringify({ at: Date.now(), items: [item] });
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const path = `inbox/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  let ok = false;
  try {
    const res = await fetch(`https://api.github.com/repos/${r.home}/contents/${path}`, {
      method: "PUT",
      headers: { Authorization: "Bearer " + r.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ message: `📨 ${item.kind === "word" ? item.word : item.title || item.url}`, content: btoa(bin) }),
    });
    ok = res.ok;
  } catch { ok = false; }
  if (!tab?.id) return;
  chrome.action.setBadgeBackgroundColor({ color: ok ? "#6B3FD1" : "#B23A28", tabId: tab.id });
  chrome.action.setBadgeText({ text: ok ? "✓" : "!", tabId: tab.id });
  chrome.action.setTitle({ title: ok ? `Đã gửi cho ${r.name}` : `Chưa gửi được cho ${r.name}: kiểm tra mạng hoặc mã trong phần Thêm người nhận`, tabId: tab.id });
  setTimeout(() => chrome.action.setBadgeText({ text: "", tabId: tab.id }), 3000);
}

async function queue(item, tab) {
  if (tab?.id) {
    chrome.action.setBadgeBackgroundColor({ color: "#2D6A4D", tabId: tab.id });
    chrome.action.setBadgeText({ text: "✓", tabId: tab.id });
    setTimeout(() => chrome.action.setBadgeText({ text: "", tabId: tab.id }), 2500);
  }
  await deliver([item]);
}

// Open the online app with the saved items in the address (#add=…). The app reads them and saves them.
// No script inside the app tab is needed, so it works even if the app tab was open before an update.
async function deliver(items) {
  const url = APP + "#add=" + encodeURIComponent(JSON.stringify({ at: Date.now(), items }));
  const [tab] = await chrome.tabs.query({ url: APP_URLS });
  if (!tab) { await chrome.tabs.create({ url }); return; }
  await chrome.tabs.update(tab.id, { url, active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
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
