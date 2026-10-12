// Runs on the app page (http://localhost:8000): passes saved pages from the extension to the app.
async function flush() {
  const items = await chrome.runtime.sendMessage({ type: "take-queue" });
  if (items?.length) window.postMessage({ source: "se-ext", items }, location.origin);
}
chrome.runtime.onMessage.addListener((m) => { if (m?.type === "flush") flush(); });
flush();
