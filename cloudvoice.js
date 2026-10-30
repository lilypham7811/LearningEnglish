// AI voice on the phone, made by GitHub.
// A phone can't run the AI voice itself (too slow to start a sentence right after a tap), so GitHub Actions in
// the private sync repo makes the audio (tools/voice/make_voice.py). This file lists every sentence that needs
// it in voice.json there (word and examples, dialog lines, speech sentences, in the chosen voices) and plays
// the finished files, audio/<voice>/<id>.mp3, like Oxford's recordings. Each file is kept on the device after
// its first download, so it plays at once and offline. Sentences not made yet use the other voices.
(() => {
  "use strict";
  const SE = window.SE;
  const LIST = "voice.json", CACHE = "se-cloudvoice-v1", KEY = "https://cloudvoice.local/";
  const DEF = { A: "af_heart", B: "am_michael" };
  const token = () => (SE.safeGet("syncToken") || "").trim();
  const voiceOf = (who) => SE.safeGet(who === "B" ? "aiVoiceB" : "aiVoiceA") || DEF[who === "B" ? "B" : "A"];
  const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
  // Short, fast id for a sentence (cyrb53), the same on every device.
  function id(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, "0");
  }
  const fileFor = (voice, text) => `audio/${voice}/${id(voice + "|" + norm(text))}.mp3`;
  const C = { have: new Set(), cached: new Set(), urls: new Map(), audio: null, done: null, gen: 0, treeTag: null,
    busyUntil: 0, timer: 0, downloading: false, wantCount: 0, readyCount: 0 };

  // ---------- What needs a voice ----------
  // Same splitting as the reading view (library.js paragraphs()), so the sentences match what is spoken.
  const sentencesOf = (text) => (text || "").split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean)
    .flatMap((p) => (p.match(/[^.!?]+[.!?]+["”’)]*|[^.!?]+$/g) || [p]).map((s) => s.trim())).filter(Boolean);
  function wanted() {
    const out = new Map();
    const add = (who, text) => {
      const t = norm(text);
      if (!t || t.length > 600 || !/[a-z]/i.test(t)) return;
      const v = voiceOf(who), f = fileFor(v, t);
      out.set(f, { f, v, t });
    };
    for (const w of SE.safeGet("words") || []) {
      add("A", w.word); // Oxford has most single words; phrases and the rest use this
      [w.context, ...(w.examples || [])].filter(Boolean).slice(0, 3).forEach((t) => add("A", t));
      (w.myExamples || []).forEach((t) => add("A", t));
    }
    for (const d of [...(window.DIALOGS || []), ...(SE.safeGet("saved") || [])]) {
      for (const l of d.lines || []) add(l[0] === 0 ? "A" : "B", l[1]);
    }
    for (const s of SE.safeGet("speeches") || []) sentencesOf(s.text).forEach((t) => add("A", t));
    // Articles only when chosen ("🎙️ Làm giọng AI cho bài này"): an article is long (40-80 sentences).
    for (const a of SE.safeGet("articles") || []) if (a.aiVoice && a.text) sentencesOf(a.text).forEach((t) => add("A", t));
    return [...out.values()];
  }

  // ---------- voice.json in the sync repo ----------
  const fromB64 = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
  const toB64 = (s) => {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  async function readList(o) {
    const r = await window.SE_SYNC.gh(`/repos/${o}/contents/${LIST}`);
    if (r.status === 404) return { list: null, sha: null };
    if (!r.ok) throw new Error("voice.json " + r.status);
    const j = await r.json();
    let text = j.content ? fromB64(j.content) : "";
    if (!text) text = await (await window.SE_SYNC.gh(`/repos/${o}/contents/${LIST}`, { headers: { Accept: "application/vnd.github.raw+json" } })).text();
    try { return { list: JSON.parse(text), sha: j.sha }; } catch { return { list: null, sha: j.sha }; }
  }
  // Send this device's sentences. The voices: the latest choice wins (a choice made here after the one in
  // voice.json is sent; otherwise this device takes that one). Sentences from the other device stay listed.
  let publishing = false;
  async function publish({ force = false } = {}) {
    if (!token() || !window.SE_SYNC || publishing) return;
    const sigOf = (list) => id(voiceOf("A") + voiceOf("B") + list.map((x) => x.f).join());
    const needEx = () => [...new Set((SE.safeGet("words") || []).filter((w) => (w.exV || 0) < 3).map((w) => w.word.toLowerCase()))].sort();
    // Articles saved by link only: GitHub fetches their text (articles.json).
    const needText = () => [...new Set((SE.safeGet("articles") || []).filter((a) => a.url && !a.text && !a.textTried).map((a) => a.url))].sort();
    let mine = wanted(), words = needEx(), links = needText();
    if (!force && sigOf(mine) + words.join() + links.join() === SE.safeGet("voiceSig")) return; // nothing new since the last check
    publishing = true;
    try {
      const o = await window.SE_SYNC.home();
      for (let attempt = 0; attempt < 3; attempt++) {
        mine = wanted();
        words = needEx();
        links = needText();
        const { list, sha } = await readList(o);
        const chosenAt = SE.safeGet("aiVoiceAt") || 0;
        if (list?.voices && chosenAt <= (list.at || 0) && (list.voices.A !== voiceOf("A") || list.voices.B !== voiceOf("B"))) {
          SE.rawSet("aiVoiceA", list.voices.A);
          SE.rawSet("aiVoiceB", list.voices.B);
          window.SE_VOICE?.refreshSettings();
          continue; // the other device chose these voices: list the sentences again with them
        }
        const voices = { A: voiceOf("A"), B: voiceOf("B") };
        const items = new Map(mine.map((x) => [x.f, x]));
        const sameVoices = list?.voices?.A === voices.A && list?.voices?.B === voices.B;
        if (sameVoices) for (const x of list.items || []) if (!items.has(x.f)) items.set(x.f, x);
        if (sameVoices && mine.every((x) => (list.items || []).some((y) => y.f === x.f)) && words.every((w) => (list.words || []).includes(w)) && links.every((u) => (list.articles || []).includes(u))) break; // already listed
        const body = { app: "shadow-english", at: Math.max(chosenAt, list?.at || 0), voices,
          items: [...items.values()].sort((a, b) => (a.f < b.f ? -1 : 1)), words, articles: links };
        const r = await window.SE_SYNC.gh(`/repos/${o}/contents/${LIST}`, { method: "PUT",
          body: JSON.stringify({ message: "AI voice: sentences to make", content: toB64(JSON.stringify(body)), ...(sha ? { sha } : {}) }) });
        if (r.status === 409 || r.status === 422) continue; // the other device wrote it first: read again
        if (!r.ok) throw new Error("voice.json " + r.status);
        C.busyUntil = Date.now() + 25 * 60000; // GitHub is making the audio: look for new files more often
        break;
      }
      SE.rawSet("voiceSig", sigOf(mine) + words.join() + links.join());
      refreshSoon(45000);
    } catch { /* offline or not allowed: try again after the next sync */ } finally { publishing = false; }
  }

  // ---------- Finished files ----------
  async function refresh() {
    clearTimeout(C.timer);
    if (!token() || !window.SE_SYNC) return;
    try {
      const o = await window.SE_SYNC.home();
      const r = await window.SE_SYNC.gh(`/repos/${o}/git/trees/main?recursive=1`, C.treeTag ? { headers: { "If-None-Match": C.treeTag } } : {});
      if (r.ok) {
        const j = await r.json();
        C.treeTag = r.headers.get("ETag");
        C.have = new Set(j.tree.filter((x) => x.type === "blob" && x.path.startsWith("audio/")).map((x) => x.path));
        const art = j.tree.find((x) => x.path === "articles.json");
        if (art && art.sha !== SE.safeGet("articlesSha")) {
          const ar = await window.SE_SYNC.gh(`/repos/${o}/contents/articles.json`, { headers: { Accept: "application/vnd.github.raw+json" } });
          if (ar.ok) { window.SE_LIB?.applyArticleTexts(await ar.json()); SE.rawSet("articlesSha", art.sha); }
        }
        const ex = j.tree.find((x) => x.path === "examples.json");
        if (ex && ex.sha !== SE.safeGet("examplesSha")) {
          const er = await window.SE_SYNC.gh(`/repos/${o}/contents/examples.json`, { headers: { Accept: "application/vnd.github.raw+json" } });
          if (er.ok) { window.SE_WORDS?.applyDictExamples(await er.json()); SE.rawSet("examplesSha", ex.sha); }
        }
      }
    } catch { /* offline */ }
    countReady();
    download();
    refreshSoon(Date.now() < C.busyUntil ? 60000 : 10 * 60000);
  }
  function refreshSoon(ms) { clearTimeout(C.timer); C.timer = setTimeout(() => { if (document.visibilityState === "visible") refresh(); else refreshSoon(ms); }, ms); }
  function countReady() {
    const w = wanted();
    C.wantCount = w.length;
    C.readyCount = w.filter((x) => C.have.has(x.f) || C.cached.has(x.f)).length;
    if (C.readyCount >= C.wantCount) C.busyUntil = 0;
    document.dispatchEvent(new Event("se:cloudvoice"));
  }
  // Keep every finished file of the chosen voices on the device (a few at a time, in the background).
  async function fetchFile(f) {
    const o = await window.SE_SYNC.home();
    const r = await window.SE_SYNC.gh(`/repos/${o}/contents/${f}`, { headers: { Accept: "application/vnd.github.raw+json" } });
    if (!r.ok) throw new Error(f + " " + r.status);
    const blob = await r.blob();
    const cache = await caches.open(CACHE);
    await cache.put(KEY + f, new Response(blob, { headers: { "Content-Type": "audio/mpeg" } }));
    C.cached.add(f);
    return blob;
  }
  async function download() {
    if (C.downloading) return;
    C.downloading = true;
    try {
      const mine = new Set(wanted().map((x) => x.f));
      const todo = [...C.have].filter((f) => mine.has(f) && !C.cached.has(f));
      const next = async () => { for (let f; (f = todo.shift()); ) await fetchFile(f).catch(() => {}); };
      await Promise.all([next(), next(), next()]);
    } finally { C.downloading = false; }
  }
  async function urlFor(f) {
    if (C.urls.has(f)) return C.urls.get(f);
    const hit = await caches.open(CACHE).then((c) => c.match(KEY + f)).catch(() => null);
    const blob = hit ? await hit.blob() : await fetchFile(f);
    const url = URL.createObjectURL(blob);
    C.urls.set(f, url);
    if (C.urls.size > 300) { const [k, u] = C.urls.entries().next().value; URL.revokeObjectURL(u); C.urls.delete(k); }
    return url;
  }

  // ---------- Playing ----------
  // A moment of silence, played inside the tap: iPhone then lets this element play the file a moment later.
  const silence = (() => {
    const n = 800, b = new DataView(new ArrayBuffer(44 + n));
    [..."RIFF"].forEach((c, i) => b.setUint8(i, c.charCodeAt(0))); b.setUint32(4, 36 + n, true);
    [..."WAVEfmt "].forEach((c, i) => b.setUint8(8 + i, c.charCodeAt(0)));
    b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, 8000, true);
    b.setUint32(28, 8000, true); b.setUint16(32, 1, true); b.setUint16(34, 8, true);
    [..."data"].forEach((c, i) => b.setUint8(36 + i, c.charCodeAt(0))); b.setUint32(40, n, true);
    for (let i = 0; i < n; i++) b.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([b], { type: "audio/wav" }));
  })();
  function has(text, who = "A") {
    const f = fileFor(voiceOf(who), text);
    return C.cached.has(f) || C.have.has(f);
  }
  // Resolves true when finished or stopped, false if the file couldn't be played (the caller uses another voice).
  function play(text, who = "A", rate = 1, onWord) {
    const f = fileFor(voiceOf(who), text);
    const a = (C.audio ||= new Audio());
    const gen = ++C.gen;
    C.done?.(true);
    a.onended = a.onerror = a.ontimeupdate = null;
    a.src = silence;
    a.play().catch(() => {});
    return new Promise((resolve) => {
      C.done = resolve;
      urlFor(f).then((url) => {
        if (gen !== C.gen) return resolve(true);
        a.src = url;
        a.playbackRate = Math.min(Math.max(rate || 1, 0.5), 2);
        a.ontimeupdate = () => { if (onWord && a.duration) onWord(Math.floor((norm(text).length * a.currentTime) / a.duration)); };
        a.onended = () => resolve(true);
        a.onerror = () => resolve(false);
        a.play().catch(() => resolve(false));
      }, () => resolve(gen !== C.gen));
    });
  }
  function stop() { C.gen++; C.audio?.pause(); C.done?.(true); C.done = null; }

  function statusText() {
    if (!token()) return "Bật đồng bộ GitHub (phần “Kết nối máy tính ↔ điện thoại” bên dưới) để có giọng AI trên điện thoại.";
    if (!C.wantCount) return "";
    const left = C.wantCount - C.readyCount;
    return left <= 0 ? `☁️ Giọng AI cho điện thoại: đủ ${C.readyCount} câu.`
      : `☁️ Giọng AI cho điện thoại: ${C.readyCount}/${C.wantCount} câu đã có · GitHub đang làm ${left} câu còn lại (vài phút, câu chưa có dùng giọng khác).`;
  }

  // ---------- Wire up ----------
  caches.open(CACHE).then((c) => c.keys()).then((keys) => {
    for (const k of keys) C.cached.add(k.url.slice(KEY.length));
    countReady();
  }).catch(() => {});
  let soon = 0;
  document.addEventListener("se:syncdone", () => { clearTimeout(soon); soon = setTimeout(() => { publish(); if (!C.treeTag) refresh(); }, 4000); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && token()) refresh(); });

  // How many of these sentences already have the AI voice (an article's "12/62 câu").
  const progress = (texts) => ({ ready: texts.filter((t) => has(t, "A")).length, total: texts.length });
  window.SE_CLOUDVOICE = { has, play, stop, publish, refresh, statusText, voiceOf, wanted, progress, sentencesOf };
})();
