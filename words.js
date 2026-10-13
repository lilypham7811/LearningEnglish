// Section 6: "Sổ từ vựng", the learner's word list.
// Words come from: clicking a word in the video subtitles, selecting text anywhere in the app,
// or right-click "Save word to LearningEnglish" in the browser extension (works with eJOY / YouTube subtitles).
// Each word keeps the sentence it came from and a link back (video at that second). Review = flashcards
// with simple spaced repetition (boxes: again today, then 1, 3, 7, 14, 30, 60 days).
(() => {
  "use strict";
  const SE = window.SE;
  const $ = (id) => document.getElementById(id);
  const esc = SE.esc;
  const DAY = 86400000;
  const BOX_DAYS = [0, 1, 3, 7, 14, 30, 60];
  const ui = { q: "", f: "all", review: null };

  const list = () => SE.safeGet("words") || [];
  function saveList(items) { SE.safeSet("words", items); updateNav(); }
  function update(id, patch) {
    saveList(list().map((x) => (x.id === id ? { ...x, ...patch } : x)));
    if (!$("view-words").hidden && !ui.review) renderList();
  }
  const toast = (t) => window.SE_LIB?.toast(t);
  const clean = (w) => (w || "").replace(/[’‘]/g, "'").replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "").trim();
  const due = () => list().filter((w) => (w.due || 0) <= Date.now());

  // ---------- Saving ----------
  async function save(raw) {
    const word = clean(raw.word);
    if (!word || word.length > 60) return null;
    const key = word.toLowerCase();
    const items = list();
    const have = items.find((x) => x.word.toLowerCase() === key);
    if (have) { toast(`“${have.word}” đã có trong Sổ từ vựng`); return have; }
    const it = {
      id: "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      word: /^[A-Z][a-z]/.test(word) && !/^I$/.test(word) ? word.toLowerCase() : word,
      context: (raw.context || "").replace(/\s+/g, " ").trim().slice(0, 400),
      sourceKind: raw.sourceKind || "", sourceTitle: raw.sourceTitle || "", sourceUrl: raw.sourceUrl || "", time: raw.time ?? null,
      savedAt: Date.now(), box: 0, due: Date.now(),
    };
    saveList([it, ...items]);
    SE.track("word");
    toast(`⭐ Đã lưu “${it.word}” vào Sổ từ vựng`);
    if (!$("view-words").hidden) render();
    lookup(it.id);
    return it;
  }

  // Meaning: Google AI (meaning in this sentence, in Vietnamese) if there is a key, otherwise a free English dictionary.
  async function lookup(id) {
    const it = list().find((x) => x.id === id);
    if (!it) return;
    let patch = null;
    try {
      if (SE.geminiKey() && window.SE_LIB) {
        patch = await window.SE_LIB.gemini({
          contents: [{ role: "user", parts: [{ text:
            `English word or phrase: "${it.word}". ${it.context ? `Sentence where I met it: "${it.context}". ` : ""}` +
            `For a Vietnamese learner, give: IPA pronunciation, part of speech, the short Vietnamese meaning${it.context ? " in this sentence" : ""}, ` +
            `a simple English definition, and one new short everyday example sentence.` }] }],
          schema: { type: "OBJECT", properties: { ipa: { type: "STRING" }, pos: { type: "STRING" }, meaningVi: { type: "STRING" }, defEn: { type: "STRING" }, example: { type: "STRING" } },
            required: ["ipa", "pos", "meaningVi", "defEn", "example"] },
        });
      } else {
        patch = await freeDictionary(it.word.toLowerCase());
      }
    } catch { /* offline or not found: the card still works, with a translate link */ }
    if (patch) update(id, patch);
  }

  // Two free English dictionaries (no key); the second is a fallback when the first is down.
  async function freeDictionary(word) {
    try {
      const r = await fetch("https://freedictionaryapi.com/api/v1/entries/en/" + encodeURIComponent(word));
      if (r.ok) {
        const e = (await r.json()).entries?.[0];
        if (e) {
          const sense = e.senses?.[0];
          return {
            ipa: e.pronunciations?.find((p) => p.type === "ipa")?.text || "",
            pos: e.partOfSpeech || "",
            defEn: sense?.definition || "",
            example: e.senses?.flatMap((s) => s.examples || []).find((x) => x.split(" ").length >= 3 && !/synonym/i.test(x)) || "",
          };
        }
      }
    } catch { /* try the other one */ }
    const r = await fetch("https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(word));
    if (!r.ok) return null;
    const e = (await r.json())[0];
    const m = e.meanings?.[0];
    return {
      ipa: e.phonetic || e.phonetics?.find((p) => p.text)?.text || "",
      pos: m?.partOfSpeech || "",
      defEn: m?.definitions?.[0]?.definition || "",
      example: e.meanings?.flatMap((x) => x.definitions).find((d) => d.example)?.example || "",
    };
  }

  // ---------- Popover for a clicked word ----------
  let pop = null;
  function closePop() { pop?.remove(); pop = null; }
  function popover(el, info) {
    closePop();
    const word = clean(info.word);
    if (!word) return;
    pop = document.createElement("div");
    pop.className = "word-pop";
    pop.innerHTML = `<b>${esc(word)}</b>
      <button type="button" class="btn small primary" data-w="save">⭐ Lưu từ</button>
      <button type="button" class="btn small" data-w="say" aria-label="Nghe">🔊</button>
      <a class="btn small" target="_blank" rel="noopener" href="https://translate.google.com/?sl=en&tl=vi&op=translate&text=${encodeURIComponent(word)}">🌐 Dịch</a>`;
    document.body.appendChild(pop);
    place(pop, el.getBoundingClientRect());
    pop.onclick = (e) => {
      const b = e.target.closest("[data-w]");
      if (!b) return;
      if (b.dataset.w === "say") SE.say(word);
      else { save({ ...info, word }); closePop(); }
    };
  }
  function place(node, r) {
    const w = node.offsetWidth;
    node.style.left = Math.max(8, Math.min(window.scrollX + r.left + r.width / 2 - w / 2, window.scrollX + document.documentElement.clientWidth - w - 8)) + "px";
    node.style.top = window.scrollY + r.bottom + 8 + "px";
  }
  document.addEventListener("pointerdown", (e) => {
    if (pop && !pop.contains(e.target) && !e.target.closest(".w2")) closePop();
    if (selBtn && !selBtn.contains(e.target)) hideSel();
  }, true);

  // ---------- Select text anywhere in the app → "⭐ Lưu" ----------
  const SEL_AREAS = ".reader-text, .speech-text, #dialog, .gai-text, .pcards, .shadow-text, .cues, .subbar, .rp-chat, .words-list, .card-ex";
  let selBtn = null, selTimer = 0;
  function hideSel() { selBtn?.remove(); selBtn = null; }
  document.addEventListener("selectionchange", () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      const sel = getSelection();
      const text = sel.toString().replace(/\s+/g, " ").trim();
      const node = sel.anchorNode?.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
      if (!text || text.length > 50 || text.split(" ").length > 5 || !/[a-z]/i.test(text) || !node?.closest?.(SEL_AREAS)) return hideSel();
      hideSel();
      selBtn = document.createElement("button");
      selBtn.type = "button";
      selBtn.className = "btn small primary sel-save";
      selBtn.textContent = `⭐ Lưu “${clean(text)}”`;
      document.body.appendChild(selBtn);
      place(selBtn, sel.getRangeAt(0).getBoundingClientRect());
      selBtn.onpointerdown = (e) => e.preventDefault(); // keep the selection
      selBtn.onclick = () => { save({ word: text, ...contextFor(node) }); hideSel(); getSelection().removeAllRanges(); };
    }, 300);
  });
  // The sentence and the source (video, article, speech, dialog) around a selected word.
  function contextFor(node) {
    const sentence = node.closest(".sent, .cue-x, .sub-line, .text, .pc-ex, li, p")?.textContent || "";
    const src = node.closest("[data-src-title]");
    if (src) return { context: sentence, sourceKind: src.dataset.srcKind, sourceTitle: src.dataset.srcTitle, sourceUrl: src.dataset.srcUrl };
    if (node.closest("#dialog, .shadow-text, .rp-chat") && SE.dialog) return { context: sentence, sourceKind: "talk", sourceTitle: SE.dialog.title };
    return { context: sentence };
  }

  // ---------- Section ----------
  function render() {
    const root = $("view-words");
    const n = list().length, d = due().length;
    root.innerHTML = `<div class="vhead"><div><p class="eyebrow">Phần 6 · Từ vựng</p><h2>Sổ từ vựng</h2>
        <p class="hint">Lưu từ: bấm vào một từ trong phụ đề video, bôi đen chữ ở bất cứ đâu trong app, hoặc trên máy tính bôi đen rồi chuột phải → <b>Save word to LearningEnglish</b> (dùng được với phụ đề eJOY).</p></div>
        <div class="kpis words-kpis">
          <div class="kpi mini" style="--pc:var(--r5)"><div class="k-label">Tổng số từ</div><div class="k-val">${n}</div></div>
          <div class="kpi mini" style="--pc:var(--r1)"><div class="k-label">Cần ôn hôm nay</div><div class="k-val">${d}</div></div>
        </div></div>
      <div class="panel" id="reviewBox"></div>
      <div class="lib-tools">
        <form class="addrow" id="wordAdd"><input class="input" name="w" placeholder="Thêm từ bằng tay: laudable" autocomplete="off" /><button class="btn">＋ Thêm</button></form>
        <div class="search"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>
          <input class="input" type="search" id="wordSearch" placeholder="Tìm từ…" value="${esc(ui.q)}" /></div>
      </div>
      <div class="seg" id="wordFilter">${[["all", "Tất cả"], ["due", "Cần ôn"], ["video", "Từ video"], ["article", "Từ bài báo"], ["other", "Khác"]]
        .map(([k, l]) => `<button data-f="${k}" aria-pressed="${ui.f === k}">${l}</button>`).join("")}</div>
      <div class="words-list" id="wordsList"></div>`;
    root.querySelector("#wordAdd").onsubmit = (e) => { e.preventDefault(); const v = e.target.w.value.trim(); if (v) { save({ word: v }); e.target.w.value = ""; } };
    root.querySelector("#wordSearch").oninput = (e) => { ui.q = e.target.value; renderList(); };
    root.querySelector("#wordFilter").onclick = (e) => {
      const b = e.target.closest("button[data-f]");
      if (!b) return;
      ui.f = b.dataset.f;
      root.querySelectorAll("#wordFilter button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      renderList();
    };
    renderReview();
    renderList();
    // Words saved while offline (or from the other device) still without a meaning: look them up now.
    list().filter((w) => !w.defEn && !w.meaningVi && !tried.has(w.id)).slice(0, 8).forEach((w) => { tried.add(w.id); lookup(w.id); });
  }
  const tried = new Set();

  const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const highlight = (sentence, word) => {
    const i = sentence.toLowerCase().indexOf(word.toLowerCase());
    return i < 0 ? esc(sentence) : esc(sentence.slice(0, i)) + `<mark>${esc(sentence.slice(i, i + word.length))}</mark>` + esc(sentence.slice(i + word.length));
  };
  function renderList() {
    const box = $("wordsList");
    if (!box) return;
    const q = ui.q.trim().toLowerCase();
    const items = list().filter((w) =>
      (!q || (w.word + " " + (w.meaningVi || "") + " " + (w.defEn || "")).toLowerCase().includes(q)) &&
      (ui.f === "all" || (ui.f === "due" && (w.due || 0) <= Date.now()) || (ui.f === "other" ? !["video", "article"].includes(w.sourceKind) : w.sourceKind === ui.f)));
    if (!items.length) {
      box.innerHTML = `<div class="panel empty"><b>${list().length ? "Không có từ nào ở đây" : "Sổ từ vựng còn trống"}</b><span>${list().length ? "Thử bộ lọc khác." : "Mở một video, bấm vào một từ trong phụ đề rồi chọn ⭐ Lưu từ."}</span></div>`;
      return;
    }
    box.innerHTML = items.map((w) => `<article class="wcard" data-id="${w.id}">
      <div class="wc-top"><b class="wc-word">${esc(w.word)}</b>${w.ipa ? `<span class="muted">${esc(w.ipa)}</span>` : ""}${w.pos ? `<span class="chip">${esc(w.pos)}</span>` : ""}
        <span class="spacer"></span><span class="wc-box" title="Mức nhớ">${"●".repeat(w.box || 0)}${"○".repeat(Math.max(0, 6 - (w.box || 0)))}</span></div>
      ${w.meaningVi ? `<div class="wc-mean">${esc(w.meaningVi)}</div>` : `<div class="wc-mean muted">${w.defEn ? "" : "Đang tra nghĩa… "}<a target="_blank" rel="noopener" href="https://translate.google.com/?sl=en&tl=vi&op=translate&text=${encodeURIComponent(w.word)}">🌐 Nghĩa tiếng Việt (Google Dịch)</a></div>`}
      ${w.defEn ? `<div class="wc-def">${esc(w.defEn)}</div>` : ""}
      ${w.context ? `<div class="wc-ctx">“${highlight(w.context, w.word)}”</div>` : ""}
      ${w.example ? `<div class="wc-ex">Ví dụ: ${esc(w.example)}</div>` : ""}
      <div class="wc-acts">
        <button type="button" class="btn small" data-a="say">🔊 Nghe</button>
        ${w.context ? `<button type="button" class="btn small" data-a="ctx">🔊 Cả câu</button>` : ""}
        <button type="button" class="btn small" data-a="speak">🎙️ Nói thử</button>
        ${w.sourceUrl ? `<a class="btn small ghost" href="${esc(w.sourceUrl)}" target="_blank" rel="noopener">${w.sourceKind === "video" ? "▶ " + (w.time != null ? fmtT(w.time) + " · " : "") : "↗ "}${esc((w.sourceTitle || "Nguồn").slice(0, 40))}</a>` : w.sourceTitle ? `<span class="muted small">${esc(w.sourceTitle.slice(0, 40))}</span>` : ""}
        <span class="spacer"></span><span class="wc-score"></span>
        <button type="button" class="btn small ghost danger" data-a="del" title="Xóa">🗑</button>
      </div></article>`).join("");
    box.onclick = (e) => {
      const b = e.target.closest("button[data-a]");
      if (!b) return;
      const card = b.closest(".wcard");
      const w = list().find((x) => x.id === card.dataset.id);
      if (!w) return;
      if (b.dataset.a === "say") SE.say(w.word);
      else if (b.dataset.a === "ctx") SE.say(w.context);
      else if (b.dataset.a === "speak") sayIt(w, b, card.querySelector(".wc-score"));
      else if (b.dataset.a === "del" && confirm(`Xóa “${w.word}” khỏi Sổ từ vựng?`)) { saveList(list().filter((x) => x.id !== w.id)); render(); }
    };
  }
  async function sayIt(w, btn, out) {
    if (!SE.hasRecognition) return toast("Trình duyệt này không chấm điểm được. Hãy dùng Chrome, Edge hoặc Safari.");
    const target = w.context && w.context.split(" ").length <= 14 ? w.context : w.word;
    btn.textContent = "🎙️ Đang nghe…";
    out.textContent = target === w.context ? "Đọc cả câu…" : "";
    const res = await SE.listenOnce(8000, target, (t) => { out.textContent = t; });
    btn.textContent = "🎙️ Nói thử";
    if (!res.text) { out.textContent = "Chưa nghe thấy gì."; return; }
    const r = SE.compareWords(target, res.text);
    SE.trackScore(r.score);
    out.innerHTML = `<span class="badge ${r.score >= 80 ? "good" : r.score >= 60 ? "ok" : "low"}">${r.score}%</span>`;
  }

  // ---------- Review (flashcards) ----------
  function renderReview() {
    const box = $("reviewBox");
    if (!box) return;
    const d = due();
    if (!ui.review) {
      box.innerHTML = `<div class="panel-body review-start">${d.length
        ? `<div><b>🃏 Ôn tập hôm nay</b><div class="hint small">${d.length} từ cần ôn. Mỗi lần nhớ được, từ sẽ được hẹn ôn lại thưa dần (1, 3, 7, 14, 30 ngày).</div></div><button class="btn primary" data-start>Bắt đầu ôn (${d.length})</button>`
        : `<div><b>✓ Đã ôn hết từ hôm nay</b><div class="hint small">${list().length ? "Quay lại ngày mai nhé." : "Lưu vài từ trước đã."}</div></div>`}</div>`;
      box.querySelector("[data-start]")?.addEventListener("click", () => { ui.review = { queue: d.map((w) => w.id).sort(() => Math.random() - 0.5), shown: false, done: 0 }; renderReview(); });
      return;
    }
    const R = ui.review;
    const w = list().find((x) => x.id === R.queue[0]);
    if (!w) {
      box.innerHTML = `<div class="panel-body review-start"><div><b>🎉 Xong! Đã ôn ${R.done} từ.</b></div><button class="btn" data-end>Đóng</button></div>`;
      box.querySelector("[data-end]").onclick = () => { ui.review = null; render(); };
      return;
    }
    const ctx = w.context ? `“${R.shown ? highlight(w.context, w.word) : esc(w.context).replace(new RegExp(w.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "_____")}”` : "";
    box.innerHTML = `<div class="panel-body flash">
      <div class="muted small">Còn ${R.queue.length} từ</div>
      <div class="flash-word">${esc(w.word)} <button type="button" class="btn small" data-say>🔊</button></div>
      ${R.shown ? "" : ctx ? `<div class="wc-ctx">${ctx}</div>` : ""}
      ${R.shown ? `${w.ipa ? `<div class="muted">${esc(w.ipa)}</div>` : ""}
        <div class="wc-mean">${esc(w.meaningVi || w.defEn || "(chưa có nghĩa)")}</div>
        ${ctx ? `<div class="wc-ctx">${ctx}</div>` : ""}${w.example ? `<div class="wc-ex">Ví dụ: ${esc(w.example)}</div>` : ""}
        <div class="toolbar flash-acts"><button class="btn" data-again>😕 Chưa nhớ</button><button class="btn primary" data-good>🙂 Nhớ rồi</button></div>`
        : `<div class="toolbar flash-acts"><button class="btn primary" data-show>Hiện nghĩa</button></div>`}
    </div>`;
    box.querySelector("[data-say]").onclick = () => SE.say(w.word);
    box.querySelector("[data-show]")?.addEventListener("click", () => { R.shown = true; renderReview(); });
    const answer = (ok) => {
      const b = ok ? Math.min((w.box || 0) + 1, BOX_DAYS.length - 1) : 0;
      update(w.id, { box: b, due: ok ? Date.now() + BOX_DAYS[b] * DAY : Date.now() + 10 * 60000 });
      R.queue.shift();
      if (!ok) R.queue.push(w.id); // see it again at the end of this round
      R.shown = false;
      R.done += ok ? 1 : 0;
      SE.track("review");
      renderReview();
      updateNav();
    };
    box.querySelector("[data-again]")?.addEventListener("click", () => answer(false));
    box.querySelector("[data-good]")?.addEventListener("click", () => answer(true));
  }

  function updateNav() {
    const n = list().length, d = due().length;
    $("navWords").textContent = n ? `${n} từ${d ? ` · ${d} cần ôn` : ""}` : "Lưu từ mới để ôn";
  }

  document.addEventListener("se:view", (e) => {
    closePop();
    if (e.detail !== "words") return;
    ui.review = null;
    SE.startSession({ id: "words", title: "Sổ từ vựng", titleVi: "Sổ từ vựng" }, "words");
    render();
  });
  document.addEventListener("se:synced", () => { updateNav(); if (!$("view-words").hidden && !ui.review) render(); });

  window.SE_WORDS = { save, popover };
  updateNav();
})();
