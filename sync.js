// Connects computer and phone: keeps one copy of the learner's data (dialogs, videos, articles, speeches,
// practice log, settings) in a private GitHub repo, read and written with the learner's own GitHub token.
// Each device merges that copy with its own: newest version of each item wins, deletions spread.
// One GitHub account can hold several learners: each has a private repo whose name starts with
// "shadow-english-sync" (e.g. shadow-english-sync-chong) and a token for that repo only; the app finds the
// repo from the token, so data never mixes.
// Also moves data from the old local address (http://localhost:8000) into the online app.
(() => {
  "use strict";
  const SE = window.SE;
  const $ = (id) => document.getElementById(id);
  const REPO = "shadow-english-sync";
  const FILE = "data.json";
  const API = "https://api.github.com";
  const ONLINE = "https://lilypham7811.github.io";
  const ONLINE_URL = ONLINE + "/LearningEnglish/";
  const LOCAL = "http://localhost:8000";
  const TOMB_DAYS = 120; // forget deletions after this long

  const token = () => (SE.safeGet("syncToken") || "").trim();
  const S = { busy: false, again: false, timer: 0, lastPush: 0, urgent: false, etag: null, remote: null };
  const PUSH_SOON = 1500;     // your own saves (words, videos, …) go up almost immediately
  const LOG_EVERY = 60000;    // the practice-time log changes every second: send it at most once a minute
  const POLL_EVERY = 15000;   // while the app is open, check for changes from the other device

  // ---------- Collect / merge ----------
  function collect(withKey) {
    const data = {};
    for (const k of SE.SYNC_LISTS) data[k] = SE.safeGet(k) || [];
    data.tomb = SE.safeGet("tomb") || {};
    for (const k of SE.SYNC_PREFS) {
      if (k === "geminiKey" && !withKey) continue;
      const v = SE.safeGet(k);
      if (v != null && v !== "") data[k] = v;
    }
    return data;
  }
  const ts = (x) => x?.updatedAt || x?.end || x?.savedAt || x?.start || 0;

  // Merge data from the other device (or a backup file) into this one. Returns what changed.
  function merge(remote) {
    if (!remote || typeof remote !== "object") return { changed: false, added: 0 };
    const tomb = { ...(SE.safeGet("tomb") || {}) };
    for (const [id, t] of Object.entries(remote.tomb || {})) tomb[id] = Math.max(tomb[id] || 0, t);
    const cutoff = Date.now() - TOMB_DAYS * 86400000;
    for (const id of Object.keys(tomb)) if (tomb[id] < cutoff) delete tomb[id];

    let changed = false, added = 0;
    for (const k of SE.SYNC_LISTS) {
      const mine = (SE.safeGet(k) || []).filter((x) => x?.id);
      const theirs = Array.isArray(remote[k]) ? remote[k].filter((x) => x?.id) : [];
      const byId = new Map(mine.map((x) => [x.id, x]));
      for (const x of theirs) {
        const cur = byId.get(x.id);
        if (!cur) { byId.set(x.id, x); added++; }
        else if (ts(x) > ts(cur)) byId.set(x.id, x);
      }
      let out = [...byId.values()].filter((x) => !(tomb[x.id] && tomb[x.id] >= ts(x)));
      out = k === "log" ? out.sort((a, b) => a.start - b.start).slice(-3000) : out.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      if (JSON.stringify(out) !== JSON.stringify(SE.safeGet(k) || [])) { SE.rawSet(k, out); changed = true; }
    }
    SE.rawSet("tomb", tomb);
    for (const k of SE.SYNC_PREFS) {
      // Settings: fill in what this device doesn't have yet (never overwrite a choice made here).
      if (remote[k] != null && remote[k] !== "" && (SE.safeGet(k) == null || SE.safeGet(k) === "")) { SE.rawSet(k, remote[k]); changed = true; }
    }
    return { changed, added };
  }

  // ---------- GitHub storage ----------
  const toB64 = (s) => {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const fromB64 = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

  async function gh(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      cache: "no-store",
      headers: { Authorization: "Bearer " + token(), Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) },
    });
    return res;
  }
  // "owner/repo" of the private repo this token may use (see the top of this file).
  async function home() {
    let h = SE.safeGet("syncHome");
    if (h) return h;
    const o = await owner();
    const r = await gh("/user/repos?per_page=100&sort=updated");
    if (!r.ok) throw new Error(`GitHub báo lỗi ${r.status}.`);
    const listed = (await r.json()).map((x) => x.full_name).filter((n) => /\/shadow-english-sync[\w.-]*$/i.test(n));
    // Only repos this token can really open (a token for one learner's repo gets 404 for the others).
    const names = [];
    for (const n of listed) if ((await gh(`/repos/${n}`)).ok) names.push(n);
    // One repo: that one. Several (a token for all repos): the usual name. None: the usual name, which then
    // explains what's missing.
    h = names.length === 1 ? names[0] : names.find((n) => n.toLowerCase() === `${o}/${REPO}`.toLowerCase()) || `${o}/${REPO}`;
    SE.rawSet("syncHome", h);
    return h;
  }
  async function owner() {
    let o = SE.safeGet("syncOwner");
    if (o) return o;
    const r = await gh("/user");
    if (r.status === 401) throw new Error("Mã đồng bộ không đúng hoặc đã hết hạn. Hãy tạo mã mới.");
    if (!r.ok) throw new Error(`GitHub báo lỗi ${r.status}.`);
    o = (await r.json()).login;
    SE.rawSet("syncOwner", o);
    return o;
  }
  // Returns { data, sha } of the shared copy, or { data: null, sha: null } if it doesn't exist yet.
  // Returns { data, sha } of the shared copy ({ data: null, sha: null } if it doesn't exist yet).
  // Conditional request: if nothing changed since last time GitHub answers 304, which is fast and
  // doesn't count against the rate limit, so checking every few seconds is fine.
  async function pull(o) {
    const conditional = S.etag && S.remote;
    const r = await gh(`/repos/${o}/contents/${FILE}`, conditional ? { headers: { "If-None-Match": S.etag } } : {});
    if (r.status === 304) return S.remote;
    if (r.status === 404) {
      const repo = await gh(`/repos/${o}`);
      if (repo.status === 404) throw new Error(`Mã đồng bộ chưa được cấp quyền cho kho “${o.split("/")[1]}”. Hãy tạo lại mã và chọn kho này (tên kho bắt đầu bằng ${REPO}).`);
      return { data: null, sha: null };
    }
    if (r.status === 401) throw new Error("Mã đồng bộ không đúng hoặc đã hết hạn. Hãy tạo mã mới.");
    if (r.status === 403) throw new Error("Mã đồng bộ chưa có quyền đọc/ghi (Contents: Read and write).");
    if (!r.ok) throw new Error(`GitHub báo lỗi ${r.status}.`);
    const j = await r.json();
    let text = j.content ? fromB64(j.content) : "";
    if (!text) { // files over 1 MB come without inline content
      const raw = await gh(`/repos/${o}/contents/${FILE}`, { headers: { Accept: "application/vnd.github.raw+json" } });
      text = await raw.text();
    }
    const json = JSON.parse(text || "{}");
    S.etag = r.headers.get("ETag");
    S.remote = { data: json.data || null, sha: j.sha };
    return S.remote;
  }
  async function push(o, data, sha) {
    const body = { message: `Sync from ${navigator.userAgent.includes("iPhone") ? "iPhone" : "computer"}`,
      content: toB64(JSON.stringify({ app: "shadow-english", version: 3, updatedAt: new Date().toISOString(), data })) };
    if (sha) body.sha = sha;
    const r = await gh(`/repos/${o}/contents/${FILE}`, { method: "PUT", body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) return false; // the other device saved first: pull again
    if (r.status === 403) throw new Error("Mã đồng bộ chưa có quyền ghi (Contents: Read and write).");
    if (!r.ok) throw new Error(`GitHub báo lỗi ${r.status} khi lưu.`);
    S.lastPush = Date.now();
    return true;
  }

  // 📨 Things someone sent to this learner from their Chrome ("Gửi … cho <name>", extension/background.js):
  // small files in inbox/ of this repo. Added to this app's lists, then deleted. Checked at most once a minute.
  let inboxAt = 0, inboxTag = null;
  async function checkInbox(o) {
    if (Date.now() - inboxAt < 60000 || !window.SE_LIB?.receive) return;
    inboxAt = Date.now();
    const r = await gh(`/repos/${o}/contents/inbox`, inboxTag ? { headers: { "If-None-Match": inboxTag } } : {});
    if (!r.ok) return; // 304: nothing new; 404: no inbox yet
    inboxTag = r.headers.get("ETag");
    const files = (await r.json()).filter((f) => f.type === "file" && f.name.endsWith(".json"));
    let got = 0;
    for (const f of files) {
      try {
        const raw = await gh(`/repos/${o}/contents/${f.path}`, { headers: { Accept: "application/vnd.github.raw+json" } });
        if (!raw.ok) continue;
        const items = (await raw.json()).items;
        if (Array.isArray(items)) { await window.SE_LIB.receive(items, { quiet: true }); got += items.length; }
        // Delete it; another device of this learner may have taken it first (then this fails, which is fine:
        // words and links that are already saved are not saved twice).
        await gh(`/repos/${o}/contents/${f.path}`, { method: "DELETE", body: JSON.stringify({ message: "📨 received", sha: f.sha }) });
      } catch { /* try again next time */ }
    }
    if (files.length) inboxTag = null;
    if (got) window.SE_LIB.toast(`📨 Có ${got} mục mới được gửi tới bạn`);
  }

  // quiet: background check (no "Đang đồng bộ…" flicker, and the practice log alone isn't pushed more than once a minute).
  async function syncNow({ quiet = false } = {}) {
    if (!token()) return setStatus("off");
    if (S.busy) { S.again = true; return; }
    S.busy = true;
    clearTimeout(S.timer);
    if (!quiet) setStatus("busy");
    try {
      SE.saveSession();
      const o = await home();
      for (let attempt = 0; attempt < 3; attempt++) {
        const remote = await pull(o);
        const { changed } = merge(remote.data);
        if (changed) { SE.refreshAll(); document.dispatchEvent(new Event("se:synced")); }
        const local = collect(true);
        if (remote.data && JSON.stringify(local) === JSON.stringify(remote.data)) { S.urgent = false; break; } // same on both sides
        // Only the practice log differs and it was sent less than a minute ago: wait for the next round.
        if (remote.data && !S.urgent && !changed && Date.now() - S.lastPush < LOG_EVERY) { schedule(LOG_EVERY - (Date.now() - S.lastPush)); break; }
        const sent = await push(o, local, remote.sha);
        if (sent) {
          S.urgent = false;
          S.remote = null; S.etag = null; // our own write: read it fresh next time
          break;
        }
        S.remote = null; S.etag = null; // the other device saved first: read again, merge, retry
      }
      SE.rawSet("syncLast", Date.now());
      setStatus("ok");
      checkInbox(o).catch(() => {});
      document.dispatchEvent(new Event("se:syncdone")); // cloudvoice.js: list new sentences for the AI voice
    } catch (err) {
      setStatus("error", err.message || "Không kết nối được. Kiểm tra Internet.");
    } finally {
      S.busy = false;
      if (S.again) { S.again = false; schedule(PUSH_SOON); }
    }
  }
  function schedule(ms) {
    clearTimeout(S.timer);
    S.timer = setTimeout(() => syncNow({ quiet: true }), ms);
  }
  // Something changed on this device. Your own saves sync in ~1.5 s; the practice log at most once a minute.
  function dirty(key) {
    if (!token()) return;
    if (key !== "log") { S.urgent = true; return schedule(PUSH_SOON); }
    if (!S.urgent) schedule(Math.max(PUSH_SOON, LOG_EVERY - (Date.now() - S.lastPush)));
  }

  // ---------- Status in the rail and in Settings ----------
  // Whose app this is: the name typed in Settings ("Tên hiện trên app"), or else from the repo name
  // (shadow-english-sync-chong → "👤 chong"; the first learner's repo shows none).
  function showLearner() {
    const tag = $("learnerTag");
    const who = (SE.safeGet("learnerName") || "").trim() ||
      (token() && (SE.safeGet("syncHome") || "").split("/")[1]?.replace(/^shadow-english-sync-?/i, "")) || "";
    tag.hidden = !who;
    tag.textContent = who ? `👤 ${who}` : "";
  }
  function setStatus(mode, msg) {
    showLearner();
    const last = SE.safeGet("syncLast");
    const time = last ? new Date(last).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "";
    const text = {
      off: "Chưa kết nối điện thoại",
      busy: "Đang đồng bộ…",
      ok: `Đã đồng bộ lúc ${time}`,
      error: "Lỗi đồng bộ",
    }[mode];
    const el = $("syncState");
    el.dataset.mode = { off: "local", busy: "loading", ok: "cloud", error: "local" }[mode];
    el.querySelector("span").textContent = text;
    $("syncStatus").textContent = mode === "error" ? "⚠ " + msg : text;
    $("syncStatus").className = "hint small" + (mode === "error" ? " sync-err" : "");
    const o = SE.safeGet("syncHome");
    $("syncInfo").innerHTML = mode === "ok" && o
      ? `✓ Đang đồng bộ với kho riêng tư <b>${SE.esc(o)}</b> · <a href="https://github.com/${o.split("/").map(encodeURIComponent).join("/")}/commits" target="_blank" rel="noopener">Lịch sử sao lưu ↗</a> · <button type="button" class="linkish" data-disconnect>Ngắt kết nối</button>`
      : "";
    storageInfo();
  }

  // ---------- Storage on this device ----------
  // Ask the browser to keep the data (not clear it when the device is low on space), and show how full it is.
  // Everything lives in localStorage (about 5 MB per site); the GitHub copy is the backup, with full history.
  async function storageInfo() {
    let bytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith("se_")) bytes += (k.length + (localStorage.getItem(k) || "").length) * 2;
    }
    const mb = bytes / 1048576;
    const kept = await navigator.storage?.persisted?.().catch(() => false);
    $("storageInfo").innerHTML = `💾 Dữ liệu trên máy này: <b>${mb < 0.1 ? "<0.1" : mb.toFixed(1)} MB</b> / khoảng 5 MB` +
      (mb > 4 ? ` <span class="sync-err">· Sắp đầy: hãy xoá bớt bài báo/video cũ không dùng.</span>` : "") +
      (kept ? " · 🔒 Được giữ lâu dài" : "");
  }
  navigator.storage?.persist?.().catch(() => {});

  // ---------- Moving data from http://localhost:8000 to the online app ----------
  function migrationBanner() {
    if (location.origin !== LOCAL) return;
    const has = SE.SYNC_LISTS.some((k) => (SE.safeGet(k) || []).length);
    const box = document.createElement("div");
    box.className = "panel migrate";
    box.innerHTML = `<div class="panel-body">
      <b>Đây là bản chạy trên máy (localhost).</b> Bản này chỉ mở được khi cửa sổ “Start LearningEnglish” còn chạy, nên hay bị lỗi “localhost refused to connect”.
      Hãy dùng <a href="${ONLINE_URL}" target="_blank" rel="noopener">bản online</a>: lúc nào cũng mở được, cài được lên điện thoại, và đồng bộ được.
      ${has ? `<div class="toolbar" style="margin-top:.6rem"><button class="btn primary" data-migrate>➜ Chuyển toàn bộ dữ liệu sang bản online</button><span class="hint small" data-mstatus></span></div>` : ""}
    </div>`;
    $("view-talk").prepend(box);
    const btn = box.querySelector("[data-migrate]");
    if (!btn) return;
    btn.onclick = () => {
      const w = window.open(ONLINE_URL + "#migrate", "_blank");
      const st = box.querySelector("[data-mstatus]");
      st.textContent = "Đang mở bản online…";
      const onMsg = (e) => {
        if (e.origin !== ONLINE || e.source !== w) return;
        if (e.data?.type === "se-migrate-ready") w.postMessage({ type: "se-migrate", data: collect(true) }, ONLINE);
        if (e.data?.type === "se-migrate-done") {
          st.textContent = `✓ Đã chuyển xong (${e.data.added} mục mới). Từ giờ hãy dùng bản online.`;
          window.removeEventListener("message", onMsg);
        }
      };
      window.addEventListener("message", onMsg);
    };
  }
  function receiveMigration() {
    if (location.origin !== ONLINE || location.hash !== "#migrate" || !window.opener) return;
    window.addEventListener("message", (e) => {
      if (e.origin !== LOCAL || e.data?.type !== "se-migrate") return;
      const { added } = merge(e.data.data);
      SE.refreshAll();
      document.dispatchEvent(new Event("se:synced"));
      e.source.postMessage({ type: "se-migrate-done", added }, LOCAL);
      history.replaceState(null, "", location.pathname);
      alert(`Đã chuyển ${added} mục từ bản trên máy sang bản online.`);
      dirty();
    });
    window.opener.postMessage({ type: "se-migrate-ready" }, LOCAL);
  }

  // ---------- Wire up ----------
  window.SE_SYNC = { collect, merge, dirty, syncNow, gh, owner, home };
  $("syncToken").value = token();
  // A pasted token is checked right away: shape first, then GitHub (who it belongs to, access to the repo).
  function useToken(v) {
    v = v.replace(/\s+/g, "");
    if (v && !/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(v)) {
      setStatus("error", "Mã không đúng dạng. Mã GitHub bắt đầu bằng github_pat_… Hãy chép lại cả mã.");
      return;
    }
    $("syncToken").value = v;
    SE.rawSet("syncToken", v);
    SE.rawSet("syncOwner", null);
    SE.rawSet("syncHome", null);
    if (v) syncNow(); else setStatus("off");
  }
  $("syncNowBtn").onclick = () => useToken($("syncToken").value);
  $("learnerName").value = SE.safeGet("learnerName") || "";
  $("learnerName").addEventListener("change", (e) => { SE.safeSet("learnerName", e.target.value.trim()); showLearner(); });
  document.addEventListener("se:synced", () => { $("learnerName").value = SE.safeGet("learnerName") || ""; showLearner(); });
  $("syncToken").addEventListener("change", () => useToken($("syncToken").value));
  $("settings").addEventListener("close", () => { if ($("syncToken").value.replace(/\s+/g, "") !== token()) useToken($("syncToken").value); });
  $("syncInfo").addEventListener("click", (e) => {
    if (!e.target.closest("[data-disconnect]")) return;
    if (!confirm("Ngắt đồng bộ trên máy này? Dữ liệu trên máy và bản sao lưu trên GitHub vẫn giữ nguyên.")) return;
    useToken("");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncNow();      // phone app reopened: get the latest
    else if (S.timer) { clearTimeout(S.timer); syncNow(); }    // leaving with unsynced changes: send them now
  });
  setInterval(() => { if (document.visibilityState === "visible" && navigator.onLine !== false) syncNow({ quiet: true }); }, POLL_EVERY);
  window.addEventListener("online", () => syncNow({ quiet: true })); // back online: catch up right away
  migrationBanner();
  receiveMigration();
  if (token()) syncNow(); else setStatus("off");
})();
