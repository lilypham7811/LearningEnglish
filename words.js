// Section 6: "Sổ từ vựng", the learner's word list, shown as a table:
// word | part of speech + IPA | listen + say it | Oxford meaning | Vietnamese meaning | 3 common examples.
// Words come from: clicking a word in the video subtitles, the box under a video, selecting text anywhere
// in the app, or right-click "Save word to LearningEnglish" in the browser extension.
// Review schedule (days after the word was learned): 1, 3, 7, 10 and 30. After the last one it is "đã thuộc".
// "Chưa nhớ" starts the schedule again from today.
(() => {
  "use strict";
  const SE = window.SE;
  const $ = (id) => document.getElementById(id);
  const esc = SE.esc;
  const DAY = 86400000;
  const SCHEDULE = [0, 1, 3, 7, 10, 30]; // stage 0 = the day it is saved; then reviews on these days
  const MASTERED = SCHEDULE.length;
  const ui = { q: "", f: "all", review: null };

  const list = () => (SE.safeGet("words") || []).map(upgrade);
  function saveList(items) { SE.safeSet("words", items); updateNav(); }
  function update(id, patch) {
    saveList(list().map((x) => (x.id === id ? { ...x, ...patch } : x)));
    if (!$("view-words").hidden && !ui.review) renderList();
  }
  const toast = (t) => window.SE_LIB?.toast(t);
  const clean = (w) => (w || "").replace(/[’‘]/g, "'").replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "").trim();
  const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const dueAt = (learnedAt, stage) => (stage >= MASTERED ? Infinity : startOfDay(learnedAt) + SCHEDULE[stage] * DAY);
  const isDue = (w) => w.stage < MASTERED && w.due <= Date.now();
  const due = () => list().filter(isDue);
  const oxfordUrl = (w) => `https://www.oxfordlearnersdictionaries.com/search/english/?q=${encodeURIComponent(w.toLowerCase())}`;
  // Words saved before the new schedule (box/due, one example) get the new fields.
  function upgrade(w) {
    if (w.stage != null) return w;
    const learnedAt = w.learnedAt || w.savedAt || Date.now();
    const stage = Math.min(w.box || 0, MASTERED);
    return { ...w, learnedAt, stage, due: dueAt(learnedAt, stage), examples: w.examples || (w.example ? [w.example] : []) };
  }

  // ---------- Saving ----------
  async function save(raw) {
    const word = clean(raw.word);
    if (!word || word.length > 60) return null;
    const key = word.toLowerCase();
    const items = list();
    const have = items.find((x) => x.word.toLowerCase() === key);
    if (have) { toast(`“${have.word}” đã có trong Sổ từ vựng`); return have; }
    const now = Date.now();
    const it = {
      id: "w" + now.toString(36) + Math.random().toString(36).slice(2, 5),
      word: /^[A-Z][a-z]/.test(word) && word !== "I" ? word.toLowerCase() : word,
      context: (raw.context || "").replace(/\s+/g, " ").trim().slice(0, 400),
      sourceKind: raw.sourceKind || "", sourceTitle: raw.sourceTitle || "", sourceUrl: raw.sourceUrl || "", time: raw.time ?? null,
      savedAt: now, learnedAt: now, stage: 0, due: dueAt(now, 0), examples: [],
    };
    saveList([it, ...items]);
    SE.track("word");
    toast(`⭐ Đã lưu “${it.word}” vào Sổ từ vựng`);
    if (!$("view-words").hidden) render();
    lookup(it.id);
    return it;
  }

  // Meanings. With a Google AI key: Google AI reads the word's Oxford Learner's Dictionaries page
  // (the site can't be read from the browser directly) and returns Oxford's part of speech, IPA, definition
  // and examples, plus the Vietnamese meaning. Without a key: a free dictionary, and the Oxford link.
  // keepWord: the learner edited the word by hand, so don't change it to its base form.
  async function lookup(id, { force = false, keepWord = false } = {}) {
    const it = list().find((x) => x.id === id);
    if (!it || (it.dictSource === "oxford" && !force && it.lemmaChecked)) return;
    let patch = null;
    try {
      if (SE.geminiKey() && window.SE_LIB) patch = await oxfordViaAi(it);
    } catch { /* fall back to the free sources */ }
    if (!patch) {
      // No key: Google's dictionary (Vietnamese meanings, Oxford Languages definitions and examples, base form),
      // topped up with IPA from the free English dictionary and everyday examples from Tatoeba.
      const g = await googleDict(it.word).catch(() => null);
      const base = keepWord ? it.word : (g?.base || it.word);
      const [f, t] = await Promise.all([freeDictionary(base.toLowerCase()).catch(() => null), tatoeba(base).catch(() => [])]);
      if (g || f) {
        // Examples: one from Oxford first, then everyday sentences from Tatoeba, then the rest of Oxford's.
        // The other free dictionary's examples are left out: they are often old quotes and headlines.
        const byLen = (a, b) => a.split(" ").length - b.split(" ").length;
        const ox = (g?.examples || []).sort(byLen);
        const examples = [...ox.slice(0, 1), ...t, ...ox.slice(1)]
          .filter((x, i, a) => a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i)
          .slice(0, 3);
        patch = {
          lemma: g?.base || "", pos: g?.pos || f?.pos || "", ipa: f?.ipa || "", defEn: g?.defEn || f?.defEn || "",
          meaningVi: g?.meaningVi || "", examples, dictSource: g ? "google" : "free",
        };
      }
    }
    if (!patch) return;
    // Save the dictionary form: "discussions" -> "discussion". The form actually seen stays in `form`
    // (to highlight it in the sentence). If the base word is already in the list, keep that one.
    const lemma = (patch.lemma || "").trim();
    delete patch.lemma;
    patch.lemmaChecked = true;
    if (!keepWord && lemma && lemma.toLowerCase() !== it.word.toLowerCase() && /^[a-z][a-z' -]*$/i.test(lemma)) {
      const twin = list().find((x) => x.id !== id && x.word.toLowerCase() === lemma.toLowerCase());
      if (twin) {
        saveList(list().filter((x) => x.id !== id));
        toast(`“${it.word}” là dạng của “${twin.word}”, từ này đã có trong sổ.`);
        if (!$("view-words").hidden && !ui.review) render();
        return;
      }
      patch.form = it.form || it.word;
      patch.word = lemma;
      toast(`Đã lưu ở dạng gốc: “${it.word}” → “${lemma}”`);
    }
    update(id, patch);
  }

  // The learner fixes a word by hand ("discussions" -> "discussion"): new meanings, same sentence and schedule.
  function editWord(id, value) {
    const it = list().find((x) => x.id === id);
    const word = clean(value);
    if (!it || !word || word === it.word) return false;
    const twin = list().find((x) => x.id !== id && x.word.toLowerCase() === word.toLowerCase());
    if (twin) { toast(`“${twin.word}” đã có trong sổ.`); return false; }
    update(id, { word, form: it.form || it.word, pos: "", ipa: "", defEn: "", meaningVi: "", examples: [], dictSource: null, lemmaChecked: true });
    tried.add(id);
    lookup(id, { force: true, keepWord: true });
    toast(`Đã sửa thành “${word}”, đang tra nghĩa mới…`);
    return true;
  }

  // Tatoeba: a free collection of simple, everyday sentences. Shortest first, 4–14 words, no near-duplicates
  // ("His first answer was laudable" / "Her first answer was laudable").
  async function tatoeba(word) {
    const r = await fetch(`https://api.tatoeba.org/unstable/sentences?lang=eng&q=${encodeURIComponent("=" + word)}&sort=words&limit=15&showtrans=none`);
    if (!r.ok) return [];
    const seen = new Set();
    return ((await r.json()).data || []).map((s) => s.text.trim())
      .filter((s) => { const n = s.split(" ").length; return n >= 4 && n <= 14; })
      .filter((s) => { const k = s.toLowerCase().split(" ").slice(1).join(" "); if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 3);
  }

  // Google Translate's dictionary data (free, readable from the browser): Vietnamese meanings by part of speech,
  // English definitions and example sentences from Oxford Languages.
  const POS_EN = { "danh từ": "noun", "động từ": "verb", "tính từ": "adjective", "trạng từ": "adverb", "giới từ": "preposition",
    "liên từ": "conjunction", "đại từ": "pronoun", "thán từ": "exclamation", "từ hạn định": "determiner", "tiền tố": "prefix", "hậu tố": "suffix" };
  async function googleDict(word) {
    const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&hl=vi&dt=t&dt=bd&dt=md&dt=ex&dj=1&q=" + encodeURIComponent(word);
    const r = await fetch(url);
    if (!r.ok) return null;
    // Google sends Vietnamese with separate accent marks (NFD); normalise so equal words compare equal.
    const d = JSON.parse((await r.text()).normalize("NFC"));
    const main = (d.sentences || []).map((s) => s.trans || "").join("").trim();
    const terms = (d.dict || []).flatMap((x) => x.terms || []);
    const vi = [main, ...terms].filter((x, i, a) => x && a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i).slice(0, 3);
    const tidy = (s) => { s = s.replace(/<[^>]+>/g, "").trim(); s = s[0].toUpperCase() + s.slice(1); return /[.!?]$/.test(s) ? s : s + "."; };
    const firstDef = d.definitions?.[0];
    return {
      base: (firstDef?.base_form || d.dict?.[0]?.base_form || "").trim(), // "discussions" -> "discussion", "went" -> "go"
      meaningVi: vi.join(", "),
      pos: [...new Set((d.definitions || d.dict || []).map((x) => POS_EN[x.pos] || x.pos))].slice(0, 2).join(", "),
      defEn: firstDef?.entry?.[0]?.gloss ? tidy(firstDef.entry[0].gloss) : "",
      examples: (d.examples?.example || []).map((e) => tidy(e.text)).filter((x) => x.split(" ").length >= 3),
    };
  }
  async function oxfordViaAi(it) {
    const url = `https://www.oxfordlearnersdictionaries.com/definition/english/${encodeURIComponent(it.word.toLowerCase().replace(/\s+/g, "-"))}`;
    const text = await window.SE_LIB.gemini({
      contents: [{ role: "user", parts: [{ text:
        `Open the Oxford Learner's Dictionaries page for the English word "${it.word}": ${url} ` +
        `(if that page doesn't exist, search https://www.oxfordlearnersdictionaries.com/search/english/?q=${encodeURIComponent(it.word)}).\n` +
        (it.context ? `I met the word in this sentence: "${it.context}". Use the meaning that fits this sentence.\n` : "Use the most common meaning.\n") +
        `Reply with JSON only, no other text:\n` +
        `{"lemma": "the dictionary form (singular noun, base verb), e.g. discussions -> discussion, went -> go", ` +
        `"pos": "part of speech as Oxford writes it (e.g. adjective)", "ipa": "Oxford's British IPA, with slashes", ` +
        `"defEn": "Oxford's definition, as written on the page", "meaningVi": "short natural Vietnamese meaning", ` +
        `"examples": ["3 of the most common, useful example sentences, Oxford's examples first"]}` }] }],
      tools: [{ urlContext: {} }],
    });
    const json = JSON.parse(text.replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, "$1"));
    if (!json.defEn) return null;
    return {
      lemma: json.lemma || "", pos: json.pos || "", ipa: json.ipa || "", defEn: json.defEn, meaningVi: json.meaningVi || "",
      examples: (json.examples || []).filter(Boolean).slice(0, 3), dictSource: "oxford",
    };
  }

  // Two free English dictionaries (no key); the second is a fallback when the first is down.
  async function freeDictionary(word) {
    const good = (x) => x && x.split(" ").length >= 4 && !/synonym|antonym/i.test(x);
    try {
      const r = await fetch("https://freedictionaryapi.com/api/v1/entries/en/" + encodeURIComponent(word));
      if (r.ok) {
        const entries = (await r.json()).entries || [];
        const e = entries[0];
        if (e) {
          const examples = entries.flatMap((x) => x.senses || []).flatMap((s) => s.examples || []).filter(good);
          return {
            ipa: e.pronunciations?.find((p) => p.type === "ipa")?.text || "",
            pos: [...new Set(entries.map((x) => x.partOfSpeech).filter(Boolean))].slice(0, 2).join(", "),
            defEn: e.senses?.[0]?.definition || "",
            examples: examples.slice(0, 3), dictSource: "free",
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
      examples: e.meanings.flatMap((x) => x.definitions).map((d) => d.example).filter(good).slice(0, 3), dictSource: "free",
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
  const STAGE_NAMES = ["Mới", "Ôn ngày 1", "Ôn ngày 3", "Ôn ngày 7", "Ôn ngày 10", "Ôn ngày 30"];
  const dayLabel = (t) => new Date(t).toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" });
  function render() {
    const root = $("view-words");
    const all = list();
    const mastered = all.filter((w) => w.stage >= MASTERED).length;
    root.innerHTML = `<div class="vhead"><div><p class="eyebrow">Phần 5 · Sổ từ vựng</p><h2>Sổ từ vựng</h2></div>
        <dl class="stat-list" aria-label="Thống kê sổ từ vựng">
          <div style="--pc:var(--r5)"><dt>Tổng số từ</dt><dd>${all.length}</dd></div>
          <div style="--pc:var(--r1)"><dt>Ôn hôm nay</dt><dd>${due().length}</dd></div>
          <div style="--pc:var(--r4)"><dt>Đã thuộc</dt><dd>${mastered}</dd></div>
        </dl></div>
      <div class="panel" id="reviewBox"></div>
      <div class="words-tools">
        <form class="cmdbar" id="wordAdd">
          <span class="cmd-ic" aria-hidden="true">＋</span>
          <input class="cmd-input" name="w" placeholder="Thêm từ mới: laudable" autocomplete="off" aria-label="Thêm từ mới" />
          <button class="btn primary">Thêm</button>
        </form>
        <div class="search"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>
          <input class="input" type="search" id="wordSearch" placeholder="Tìm trong sổ…" value="${esc(ui.q)}" /></div>
      </div>
      <div class="lib-tools">
        <div class="seg" id="wordFilter">${[["all", "Tất cả"], ["due", "Ôn hôm nay"], ["learning", "Đang học"], ["mastered", "Đã thuộc"], ["video", "Từ video"]]
          .map(([k, l]) => `<button data-f="${k}" aria-pressed="${ui.f === k}">${l}</button>`).join("")}</div>
        ${SE.geminiKey() && all.some((w) => w.dictSource !== "oxford") ? `<button class="btn ghost" id="oxfordAll">🔄 Lấy nghĩa Oxford cho các từ cũ</button>` : ""}
      </div>
      <div class="panel words-table-wrap"><div class="table-scroll"><table class="lib words-table" id="wordsList"></table></div></div>`;
    root.querySelector("#wordAdd").onsubmit = (e) => { e.preventDefault(); const v = e.target.w.value.trim(); if (v) { save({ word: v }); e.target.w.value = ""; } };
    root.querySelector("#wordSearch").oninput = (e) => { ui.q = e.target.value; renderList(); };
    root.querySelector("#wordFilter").onclick = (e) => {
      const b = e.target.closest("button[data-f]");
      if (!b) return;
      ui.f = b.dataset.f;
      root.querySelectorAll("#wordFilter button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      renderList();
    };
    root.querySelector("#oxfordAll")?.addEventListener("click", async (e) => {
      const b = e.currentTarget;
      const todo = list().filter((w) => w.dictSource !== "oxford");
      b.disabled = true;
      for (let i = 0; i < todo.length; i++) {
        b.textContent = `Đang lấy nghĩa Oxford… ${i + 1}/${todo.length}`;
        await lookup(todo[i].id, { force: true });
      }
      render();
    });
    renderReview();
    renderList();
    // Words saved while offline (or from the other device) still without a meaning: look them up now.
    // Also upgrades words looked up with the older, weaker dictionary (no Vietnamese meaning).
    list().filter((w) => (!w.defEn || !w.lemmaChecked || (!w.meaningVi && w.dictSource !== "oxford")) && !tried.has(w.id)).slice(0, 10)
      .forEach((w) => { tried.add(w.id); lookup(w.id, { force: true }); });
  }
  const tried = new Set();

  const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const mark = (w, sentence) => highlight(sentence, w.form && !sentence.toLowerCase().includes(w.word.toLowerCase()) ? w.form : w.word);
  const highlight = (sentence, word) => {
    const i = sentence.toLowerCase().indexOf(word.toLowerCase());
    return i < 0 ? esc(sentence) : esc(sentence.slice(0, i)) + `<mark>${esc(sentence.slice(i, i + word.length))}</mark>` + esc(sentence.slice(i + word.length));
  };
  function stageBadge(w) {
    if (w.stage >= MASTERED) return `<span class="chip st-done">✓ Đã thuộc</span>`;
    if (isDue(w)) return `<span class="chip st-due">Ôn hôm nay</span>`;
    const tomorrow = startOfDay(Date.now()) + DAY;
    return `<span class="chip">Ôn ${startOfDay(w.due) === tomorrow ? "ngày mai" : dayLabel(w.due)}</span>`;
  }
  function renderList() {
    const box = $("wordsList");
    if (!box) return;
    const q = ui.q.trim().toLowerCase();
    const items = list().filter((w) =>
      (!q || (w.word + " " + (w.meaningVi || "") + " " + (w.defEn || "")).toLowerCase().includes(q)) &&
      (ui.f === "all" || (ui.f === "due" && isDue(w)) || (ui.f === "learning" && w.stage < MASTERED) ||
       (ui.f === "mastered" && w.stage >= MASTERED) || (ui.f === "video" && w.sourceKind === "video")));
    if (!items.length) {
      box.innerHTML = `<tbody><tr><td class="empty-row">${list().length ? "Không có từ nào ở đây. Thử bộ lọc khác." : "Sổ từ vựng còn trống. Mở một video, bấm vào một từ trong phụ đề (hoặc gõ vào ô dưới video) rồi chọn ⭐ Lưu từ."}</td></tr></tbody>`;
      return;
    }
    box.innerHTML = `<thead><tr><th>Từ</th><th>Dạng từ · Phiên âm</th><th>Nghe · Nói thử</th><th>Nghĩa (Oxford)</th><th>Nghĩa tiếng Việt</th><th>3 câu ví dụ thông dụng</th></tr></thead><tbody>` +
      items.map((w) => `<tr data-id="${w.id}">
        <td data-label="Từ"><b class="wc-word">${esc(w.word)}</b>${w.form && w.form.toLowerCase() !== w.word.toLowerCase() ? `<small class="wc-form" title="Dạng bạn đã gặp">từ “${esc(w.form)}”</small>` : ""}
          <div class="wc-meta">${stageBadge(w)}</div>
          ${w.sourceUrl ? `<a class="wc-src" href="${esc(w.sourceUrl)}" target="_blank" rel="noopener" title="${esc(w.sourceTitle || "")}">${w.sourceKind === "video" ? "▶ " + (w.time != null ? fmtT(w.time) : "video") : "↗ nguồn"}</a>` : ""}
          <span class="wc-row-acts"><button type="button" class="wc-edit" data-a="edit" title="Sửa từ" aria-label="Sửa từ">✏️</button><button type="button" class="wc-del" data-a="del" title="Xóa từ" aria-label="Xóa từ">🗑</button></span></td>
        <td data-label="Dạng từ · Phiên âm">${w.pos ? `<span class="chip">${esc(w.pos)}</span>` : ""}<div class="wc-ipa">${esc(w.ipa || "")}</div></td>
        <td data-label="Nghe · Nói thử"><div class="wc-acts">
          <button type="button" class="btn small" data-a="say" title="Nghe từ">🔊 Nghe</button>
          <button type="button" class="btn small" data-a="speak" title="Nói thử và chấm điểm">🎙️ Nói thử</button></div>
          <div class="wc-score"></div></td>
        <td data-label="Nghĩa (Oxford)">${w.defEn ? `<div class="wc-def">${esc(w.defEn)}</div>` : `<span class="muted small">${tried.has(w.id) ? "Chưa tìm thấy" : "Đang tra…"}</span>`}
          <a class="wc-ox" href="${oxfordUrl(w.word)}" target="_blank" rel="noopener">${w.dictSource === "oxford" ? "Oxford ↗" : "Xem trên Oxford ↗"}</a></td>
        <td data-label="Nghĩa tiếng Việt">${w.meaningVi ? `<div class="wc-mean">${esc(w.meaningVi)}</div>` : `<a class="small" target="_blank" rel="noopener" href="https://translate.google.com/?sl=en&tl=vi&op=translate&text=${encodeURIComponent(w.word)}">🌐 Google Dịch</a>`}</td>
        <td data-label="3 câu ví dụ"><ol class="wc-exs">${[...(w.context ? [{ t: w.context, mine: true }] : []), ...(w.examples || []).map((t) => ({ t }))].slice(0, 3)
          .map((x, i) => `<li${x.mine ? ' class="mine" title="Câu bạn gặp từ này"' : ""}><button type="button" class="ex-say" data-a="ex" data-i="${i}" aria-label="Nghe câu">🔊</button> ${mark(w, x.t)}</li>`).join("") || '<li class="muted">Đang tìm câu ví dụ…</li>'}</ol></td>
      </tr>`).join("") + "</tbody>";
    box.onclick = (e) => {
      const b = e.target.closest("[data-a]");
      if (!b) return;
      const row = b.closest("tr");
      const w = list().find((x) => x.id === row.dataset.id);
      if (!w) return;
      const exs = [...(w.context ? [w.context] : []), ...(w.examples || [])].slice(0, 3);
      if (b.dataset.a === "say") SE.say(w.word);
      else if (b.dataset.a === "ex") SE.say(exs[+b.dataset.i] || w.word);
      else if (b.dataset.a === "speak") sayIt(w, b, row.querySelector(".wc-score"));
      else if (b.dataset.a === "edit") openEditor(row, w);
      else if (b.dataset.a === "del" && confirm(`Xóa “${w.word}” khỏi Sổ từ vựng?`)) { saveList(list().filter((x) => x.id !== w.id)); render(); }
    };
  }
  function openEditor(row, w) {
    const cell = row.cells[0];
    cell.innerHTML = `<form class="wc-editor"><input class="input" value="${esc(w.word)}" aria-label="Sửa từ" autocomplete="off" spellcheck="false" />
      <div class="toolbar"><button class="btn small primary">Lưu</button><button type="button" class="btn small ghost" data-cancel>Huỷ</button></div></form>`;
    const f = cell.querySelector("form"), inp = f.querySelector("input");
    inp.focus(); inp.select();
    f.onsubmit = (e) => { e.preventDefault(); editWord(w.id, inp.value); renderList(); };
    f.querySelector("[data-cancel]").onclick = () => renderList();
    inp.onkeydown = (e) => { if (e.key === "Escape") renderList(); };
  }
  async function sayIt(w, btn, out) {
    if (!SE.hasRecognition) return toast("Trình duyệt này không chấm điểm được. Hãy dùng Chrome, Edge hoặc Safari.");
    btn.textContent = "🎙️ Đang nghe…";
    out.textContent = "";
    const res = await SE.listenOnce(6000, w.word, (t) => { out.textContent = t; });
    btn.textContent = "🎙️ Nói thử";
    if (!res.text) { out.textContent = "Chưa nghe thấy gì."; return; }
    const r = SE.compareWords(w.word, res.text);
    SE.trackScore(r.score);
    out.innerHTML = `<span class="badge ${r.score >= 80 ? "good" : r.score >= 60 ? "ok" : "low"}">${r.score}%</span> <span class="muted small">${esc(res.text)}</span>`;
  }

  // ---------- Daily review (flashcards) ----------
  // "Tiếp theo: ngày mai · 2 từ" (or the first day with words to review).
  function nextReview() {
    const tomorrow = startOfDay(Date.now()) + DAY;
    const upcoming = list().filter((w) => w.stage < MASTERED && w.due >= tomorrow);
    if (!upcoming.length) return list().length ? "Không có từ nào hẹn ôn sắp tới." : "Lưu từ mới để bắt đầu.";
    const day = Math.min(...upcoming.map((w) => startOfDay(w.due)));
    const n = upcoming.filter((w) => startOfDay(w.due) === day).length;
    const when = day === tomorrow ? "ngày mai" : dayLabel(day);
    return `Tiếp theo: ${when} · ${n} từ`;
  }
  function renderReview() {
    const box = $("reviewBox");
    if (!box) return;
    const d = due();
    if (!ui.review) {
      // One line: what to do today and when the next review is. The schedule rule sits behind ⓘ.
      box.innerHTML = `<div class="review-bar">
        <span class="rv-ic" aria-hidden="true">${d.length ? "🃏" : "✓"}</span>
        <div class="rv-text"><b>${d.length ? `Hôm nay ôn ${d.length} từ` : list().length ? "Hôm nay đã ôn xong" : "Chưa có từ để ôn"}</b>
          <span class="muted small">${nextReview()}</span>
          <span class="rv-info" tabindex="0" title="Mỗi từ được ôn vào ngày thứ 1, 3, 7, 10 và 30 sau khi học. Ôn đủ 5 lần là đã thuộc. Bấm “Chưa nhớ” thì từ đó học lại từ đầu." aria-label="Lịch ôn: ngày 1, 3, 7, 10 và 30 sau khi học">ⓘ</span></div>
        <div class="toolbar">${d.length ? `<button class="btn primary" data-start>Bắt đầu ôn</button>` : ""}
          ${list().length ? `<button class="btn" data-voice>🎙️ Ôn bằng giọng nói</button>` : ""}</div>
      </div>`;
      // Voice review in ChatGPT / Gemini: today's words, or the 12 newest if none are due.
      box.querySelector("[data-voice]")?.addEventListener("click", () => {
        const words = (d.length ? d : list()).slice(0, 12);
        window.SE_HANDOFF.open({ title: `Ôn ${words.length} từ`, prompt: window.SE_HANDOFF.wordsPrompt(words) });
      });
      box.querySelector("[data-start]")?.addEventListener("click", () => {
        ui.review = { queue: d.sort((a, b) => a.due - b.due).map((w) => w.id), shown: false, done: 0, again: new Set() };
        renderReview();
      });
      return;
    }
    const R = ui.review;
    const w = list().find((x) => x.id === R.queue[0]);
    if (!w) {
      box.innerHTML = `<div class="panel-body review-start"><div><b>🎉 Xong! Đã ôn ${R.done} từ hôm nay.</b></div><button class="btn" data-end>Đóng</button></div>`;
      box.querySelector("[data-end]").onclick = () => { ui.review = null; render(); };
      return;
    }
    const exs = [...(w.context ? [w.context] : []), ...(w.examples || [])].slice(0, 3);
    const esc_re = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const blank = (txt) => [w.word, w.form].filter(Boolean).reduce((acc, f) => acc.replace(new RegExp(esc_re(f), "ig"), "_____"), esc(txt));
    box.innerHTML = `<div class="panel-body flash">
      <div class="muted small">Còn ${R.queue.length} từ · ${STAGE_NAMES[Math.min(w.stage, STAGE_NAMES.length - 1)]}</div>
      <div class="flash-word">${esc(w.word)} <button type="button" class="btn small" data-say>🔊</button></div>
      ${R.shown ? `<div class="muted">${esc([w.pos, w.ipa].filter(Boolean).join(" · "))}</div>
          ${w.meaningVi ? `<div class="wc-mean">${esc(w.meaningVi)}</div>` : ""}${w.defEn ? `<div class="wc-def">${esc(w.defEn)}</div>` : ""}
          ${exs.length ? `<ol class="wc-exs">${exs.map((s) => `<li>${mark(w, s)}</li>`).join("")}</ol>` : ""}
          <div class="toolbar flash-acts"><button class="btn" data-again>😕 Chưa nhớ</button><button class="btn primary" data-good>🙂 Nhớ rồi</button></div>`
        : `${exs[0] ? `<div class="wc-ctx">“${blank(exs[0])}”</div>` : ""}
          <div class="hint small">Nhớ nghĩa của từ này không? Thử nói một câu với từ này, rồi bấm Hiện nghĩa.</div>
          <div class="toolbar flash-acts"><button class="btn primary" data-show>Hiện nghĩa</button></div>`}
    </div>`;
    box.querySelector("[data-say]").onclick = () => SE.say(w.word);
    box.querySelector("[data-show]")?.addEventListener("click", () => { R.shown = true; renderReview(); });
    const answer = (ok) => {
      const now = Date.now();
      let patch;
      if (ok && !R.again.has(w.id)) {
        const stage = Math.min(w.stage + 1, MASTERED);
        // Next review on the schedule day; if days were missed, no earlier than tomorrow.
        const next = stage >= MASTERED ? null : Math.max(dueAt(w.learnedAt, stage), startOfDay(now) + DAY);
        patch = { stage, due: next };
      } else if (ok) {
        // Forgot earlier today, remembered now: today counts as day 0 of the restarted schedule.
        patch = { stage: 1, due: dueAt(w.learnedAt, 1) };
      } else {
        patch = { stage: 0, learnedAt: now, due: dueAt(now, 0) };
        R.again.add(w.id);
      }
      update(w.id, patch);
      R.queue.shift();
      if (!ok) R.queue.push(w.id); // once more at the end of today's round
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
    $("navWords").textContent = n ? `${n} từ${d ? ` · ${d} cần ôn hôm nay` : ""}` : "Lưu từ mới để ôn";
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
