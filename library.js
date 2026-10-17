// Sections 3-5: saved YouTube news videos, saved news articles, and public-speaking practice.
// Each item has a "Google AI" chat (Gemini, the learner's own free key) that knows the item's content.
(() => {
  "use strict";
  const SE = window.SE;
  const $ = (id) => document.getElementById(id);
  const esc = SE.esc;
  const MODEL = "gemini-3.8-flash";
  const API = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  const KINDS = {
    video: {
      key: "videos", eyebrow: "Phần 3 · Video tin tức", h2: "Video YouTube đã lưu",
      hint: "Mở video trên YouTube, bấm chuột phải vào trang → <b>Save to LearningEnglish</b>. Hoặc dán link vào ô dưới.",
      empty: "Chưa có video nào. Lưu một bản tin YouTube để bắt đầu.", unit: "video",
      chips: [["phrases3", "✨ 3 cụm từ hay nhất"], ["vocab", "📚 Từ mới"], ["transcript", "📝 Lời thoại"], ["summary", "📰 Tóm tắt"], ["live", "🎙️ Luyện nói về video"]],
    },
    article: {
      key: "articles", eyebrow: "Phần 4 · Bài báo", h2: "Bài báo để đọc",
      hint: "Mở bài báo, bấm chuột phải → <b>Save to LearningEnglish</b> (tự lưu cả nội dung). Hoặc dán link vào ô dưới.",
      empty: "Chưa có bài báo nào. Lưu một bài tin tức tiếng Anh để bắt đầu.", unit: "bài",
      chips: [["phrases5", "✨ 3–5 câu hay nhất để luyện"], ["vocab", "📚 Từ mới"], ["summary", "📰 Tóm tắt dễ hiểu"], ["live", "🎙️ Luyện nói về bài này"]],
    },
    speech: {
      key: "speeches", eyebrow: "Phần 5 · Phát biểu", h2: "Trở thành người nói hay nhất",
      hint: "Dán bài phát biểu, hoặc nhờ Google AI viết. Mỗi ngày: đọc chạy chữ, ghi âm, nghe AI nhận xét, rồi nói lại hay hơn.",
      empty: "Chưa có bài phát biểu nào. Dán một bài hoặc nhờ AI viết bài đầu tiên.", unit: "bài",
      chips: [["critique", "🎯 Góp ý bài viết"], ["phrases5", "✨ Cụm từ đắt giá"], ["delivery", "🗣️ Cách nói bài này"], ["live", "🎤 Tập trả lời khán giả"]],
    },
  };
  const ui = { video: { open: null, q: "" }, article: { open: null, q: "" }, speech: { open: null, q: "" } };

  // ---------- Storage ----------
  const list = (kind) => SE.safeGet(KINDS[kind].key) || [];
  function saveList(kind, items) {
    if (!SE.safeSet(KINDS[kind].key, items)) toast("⚠ Bộ nhớ trình duyệt đã đầy. Hãy xóa bớt bài cũ.");
    updateNav();
  }
  const getItem = (kind, id) => list(kind).find((x) => x.id === id);
  function updateItem(kind, id, patch) {
    const items = list(kind).map((x) => (x.id === id ? { ...x, ...patch } : x));
    saveList(kind, items);
    return items.find((x) => x.id === id);
  }
  const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  // action = { label, run }: a button in the message (e.g. "Hoàn tác" to undo a save).
  function toast(text, action) {
    const t = $("toast");
    t.textContent = text;
    if (action) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "toast-btn";
      b.textContent = action.label;
      b.onclick = () => { t.hidden = true; action.run(); };
      t.append(" ", b);
    }
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, action ? 8000 : 3200);
  }

  // ---------- YouTube helpers ----------
  function youtubeId(url) {
    try {
      const u = new URL(url.trim());
      if (/(^|\.)youtu\.be$/.test(u.hostname)) return u.pathname.slice(1, 12);
      if (!/(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname)) return null;
      if (u.searchParams.get("v")) return u.searchParams.get("v").slice(0, 11);
      const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([\w-]{11})/);
      return m ? m[2] : null;
    } catch { return null; }
  }
  const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;
  const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const words = (t) => (t || "").trim().split(/\s+/).filter(Boolean).length;
  const dateVi = (t) => new Date(t).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });

  // Add (or merge) an item coming from the page form or the browser extension.
  async function addItem(raw, { open = false, undo = false } = {}) {
    const vid = youtubeId(raw.url || "");
    const kind = raw.kind || (vid ? "video" : "article");
    const items = list(kind);
    const url = vid ? watchUrl(vid) : raw.url;
    const dupe = items.find((x) => x.url === url && url);
    if (dupe) {
      if (kind === "article" && raw.text && !dupe.text) updateItem(kind, dupe.id, { text: raw.text.slice(0, 40000) });
      toast("Đã có trong danh sách: " + dupe.title);
      if (open) openItem(kind, dupe.id);
      return dupe;
    }
    let item;
    if (kind === "video") {
      item = { id: newId("v"), url, videoId: vid, title: raw.title || "", channel: raw.channel || "", savedAt: Date.now(), chat: [] };
      if (!item.title) Object.assign(item, await youtubeInfo(url));
    } else if (kind === "article") {
      const text = (raw.text || "").slice(0, 40000);
      item = { id: newId("a"), url, title: raw.title || hostOf(url) || "Bài báo", site: raw.site || hostOf(url), image: raw.image || "",
        text, excerpt: (raw.excerpt || text).slice(0, 260), savedAt: Date.now(), chat: [] };
    } else {
      item = { id: newId("p"), title: raw.title || "Bài phát biểu", text: raw.text || "", tips: raw.tips || "", source: raw.source || "Dán vào",
        savedAt: Date.now(), chat: [] };
    }
    saveList(kind, [item, ...list(kind)]);
    toast(`✓ Đã lưu: ${item.title}`, undo ? { label: "Hoàn tác", run: () => {
      saveList(kind, list(kind).filter((x) => x.id !== item.id));
      if (ui[kind].open === item.id) ui[kind].open = null;
      if (!$("view-" + kind).hidden) render(kind);
      toast("Đã bỏ bài vừa lưu.");
    } } : null);
    if (open) openItem(kind, item.id);
    else if (!$("view-" + kind).hidden) render(kind);
    return item;
  }
  async function youtubeInfo(url) {
    try {
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
      if (!r.ok) throw 0;
      const j = await r.json();
      return { title: j.title || "Video YouTube", channel: j.author_name || "" };
    } catch {
      return { title: "Video YouTube", channel: "" };
    }
  }

  // ---------- Gemini ----------
  async function gemini({ system, contents, schema, tools }) {
    const key = SE.geminiKey();
    if (!key) { SE.openSettings(); throw new Error("cần khoá Google AI (miễn phí). Dán khoá trong Cài đặt."); }
    const body = { contents };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (schema) body.generationConfig = { responseMimeType: "application/json", responseSchema: schema };
    if (tools) body.tools = tools;
    const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(SE.geminiError(res.status, json));
    const text = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
    if (!text) throw new Error("Google AI không trả lời. Hãy thử lại.");
    return schema ? JSON.parse(text) : text;
  }

  // The text the AI works from: a video's transcript (Gemini watches the video once), an article's body, a speech.
  async function sourceText(kind, item, onStatus, { needCues = false } = {}) {
    if (kind === "video") {
      if (item.cues?.length) return cuesText(item.cues);
      if (item.transcript && !needCues) return item.transcript; // older transcript without times
      onStatus("Google AI đang xem video và chép lời thoại kèm thời gian (lần đầu, mất khoảng 10–60 giây)…");
      const t = await gemini({ contents: [{ role: "user", parts: [
        { fileData: { fileUri: item.url } },
        { text: "Transcribe all speech in this video in English, word for word. Put each sentence on its own line, " +
          "starting with the time in the video when that sentence starts, as [m:ss] (or [h:mm:ss]). Output only those lines." },
      ] }] });
      const cues = parseCues(t);
      const transcript = cues.length ? cuesText(cues) : t;
      Object.assign(item, updateItem(kind, item.id, { transcript, cues }));
      if (ui.video.open === item.id) renderTranscript(item);
      return transcript;
    }
    if (kind === "article") {
      if (item.text) return item.text;
      onStatus("Google AI đang đọc bài báo từ đường link…");
      const t = await gemini({
        contents: [{ role: "user", parts: [{ text: `Read this news article: ${item.url}\nOutput the full main article text exactly as written (no menus, ads or comments), in paragraphs separated by blank lines. On the first line write the headline.` }] }],
        tools: [{ urlContext: {} }],
      });
      const [first, ...rest] = t.split("\n");
      const patch = { text: rest.join("\n").trim() || t, excerpt: (rest.join(" ").trim() || t).slice(0, 260) };
      if (!item.title || item.title === item.site) patch.title = first.replace(/^#+\s*/, "").trim().slice(0, 160);
      Object.assign(item, updateItem(kind, item.id, patch));
      if (ui.article.open === item.id) renderDetail("article");
      return item.text;
    }
    return item.text;
  }

  const KIND_LABEL = { video: "news video", article: "news article", speech: "speech" };
  function systemFor(kind, item, text) {
    return `You are Google AI, a friendly, expert English tutor for a Vietnamese learner (intermediate level) who wants to speak natural, confident English. ` +
      `The learner is studying this ${KIND_LABEL[kind]}: "${item.title}"${item.channel ? ` by ${item.channel}` : ""}${item.site ? ` from ${item.site}` : ""}.\n` +
      `Answer like a helpful assistant: clear structure, short paragraphs, **bold** key phrases, bullet lists where useful. ` +
      `Explain in Vietnamese, but keep English phrases and examples in English. Be concise and practical. ` +
      `When the learner wants to practise, be a conversation partner: ask one question at a time and correct mistakes kindly.\n\n` +
      `CONTENT:\n<<<\n${text.slice(0, 60000)}\n>>>`;
  }

  // Quick actions: what each chip asks the AI.
  const PHRASE_SCHEMA = {
    type: "OBJECT",
    properties: { items: { type: "ARRAY", items: { type: "OBJECT", properties: {
      phrase: { type: "STRING", description: "the English phrase or sentence to practise" },
      meaning: { type: "STRING", description: "natural Vietnamese meaning" },
      note: { type: "STRING", description: "in Vietnamese: when and how to use it, in one sentence" },
      example: { type: "STRING", description: "an English example sentence using it (from the content if possible)" },
    }, required: ["phrase", "meaning", "note", "example"] } } },
    required: ["items"],
  };
  const VOCAB_SCHEMA = {
    type: "OBJECT",
    properties: { items: { type: "ARRAY", items: { type: "OBJECT", properties: {
      phrase: { type: "STRING", description: "the English word" },
      ipa: { type: "STRING", description: "IPA pronunciation" },
      meaning: { type: "STRING", description: "part of speech and natural Vietnamese meaning" },
      note: { type: "STRING", description: "in Vietnamese: a short usage note or common collocation" },
      example: { type: "STRING", description: "the sentence from the content where it appears, or a natural example" },
    }, required: ["phrase", "ipa", "meaning", "note", "example"] } } },
    required: ["items"],
  };
  const ACTIONS = {
    phrases3: { label: "3 cụm từ hay nhất", schema: PHRASE_SCHEMA, ask: "Pick the 3 best, most useful phrases from this content that I can reuse in everyday conversation." },
    phrases5: { label: "Câu & cụm từ hay nhất để luyện", schema: PHRASE_SCHEMA, ask: "Pick the 3 to 5 best sentences or phrases from this content that are common in real life and worth practising out loud. Prefer complete short sentences or strong phrases." },
    vocab: { label: "Từ mới", schema: VOCAB_SCHEMA, ask: "Pick 8 useful new words from this content for an intermediate learner (skip very basic words)." },
    summary: { label: "Tóm tắt", ask: "Tóm tắt nội dung này thật dễ hiểu bằng tiếng Việt (5–7 gạch đầu dòng), rồi viết 3 câu tóm tắt bằng tiếng Anh đơn giản mà tôi có thể nói lại." },
    transcript: { label: "Lời thoại", ask: null },
    critique: { label: "Góp ý bài viết", ask: "Act as a world-class speech coach. Review this speech: what works, what is weak (structure, opening hook, story, rhythm, call to action), and give 3 specific rewrites of weak sentences. Answer in Vietnamese with English examples." },
    delivery: { label: "Cách nói bài này", ask: "Coach me on how to deliver this speech out loud: where to pause (mark with /), which words to stress (in CAPS), the emotion and pace for each part, and pronunciation traps for a Vietnamese speaker. Use short sections." },
  };

  // ---------- Chat rendering (styled like Google AI) ----------
  function md(text) {
    const lines = esc(text).split("\n");
    let html = "", list = null;
    const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<i>$2</i>").replace(/`(.+?)`/g, "<code>$1</code>");
    const close = () => { if (list) { html += `</${list}>`; list = null; } };
    for (const raw of lines) {
      const l = raw.trimEnd();
      let m;
      if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { if (list !== "ul") { close(); html += "<ul>"; list = "ul"; } html += `<li>${inline(m[1])}</li>`; }
      else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== "ol") { close(); html += "<ol>"; list = "ol"; } html += `<li>${inline(m[1])}</li>`; }
      else if ((m = l.match(/^#{1,4}\s+(.*)/))) { close(); html += `<h4>${inline(m[1])}</h4>`; }
      else if (!l.trim()) close();
      else { close(); html += `<p>${inline(l)}</p>`; }
    }
    close();
    return html;
  }

  function chatHtml(kind) {
    const k = KINDS[kind];
    return `<div class="gai" id="gai-${kind}">
      <div class="gai-head"><span class="gai-logo"><i></i>Google AI</span>
        <span class="gai-head-acts"><button type="button" class="gai-aimode btn ghost small" title="Hỏi trong Google AI Mode (tab mới, miễn phí)">↗ AI Mode</button><button type="button" class="gai-clear btn ghost small" title="Xóa cuộc trò chuyện">Xóa chat</button></span></div>
      ${SE.geminiKey() ? "" : `<div class="gai-mode-note">Chưa có khoá: câu hỏi sẽ mở <b>Google AI Mode</b> trong tab mới (miễn phí). <button type="button" class="linkish" data-key>Dán khoá</button> để AI trả lời ngay tại đây, có thẻ chấm điểm và nói chuyện bằng giọng.</div>`}
      <div class="gai-log"></div>
      <div class="gai-chips">${k.chips.map(([a, l]) => `<button type="button" data-a="${a}">${l}</button>`).join("")}</div>
      <form class="gai-input">
        <div class="gai-pill">
          <input type="text" placeholder="Ask anything" autocomplete="off" />
          <button type="button" class="gai-lang" title="Ngôn ngữ khi nói vào micro">EN</button>
          <button type="button" class="gai-mic" title="Nói để nhập chữ"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg></button>
        </div>
        <button type="button" class="gai-live" title="Nói chuyện trực tiếp bằng giọng nói"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 10v4M9 7v10M13 9v6M17 11v2"/><path d="M19 3.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="currentColor" stroke-width="1"/></svg></button>
      </form>
    </div>`;
  }

  function renderChat(kind, item) {
    const log = document.querySelector(`#gai-${kind} .gai-log`);
    if (!log) return;
    const msgs = item.chat || [];
    log.innerHTML = msgs.length ? msgs.map((m, i) => msgHtml(m, i)).join("") :
      `<div class="gai-hello"><b>Xin chào!</b> Mình là Google AI. Hỏi mình bất cứ điều gì về ${kind === "video" ? "video" : kind === "article" ? "bài báo" : "bài phát biểu"} này, hoặc chọn một gợi ý bên dưới.</div>`;
    log.scrollTop = log.scrollHeight;
  }
  function msgHtml(m, i) {
    if (m.role === "user") return `<div class="gai-msg user"><div class="gai-bubble">${esc(m.text)}</div></div>`;
    if (m.role === "status") return `<div class="gai-msg status"><span class="gai-dots"><i></i><i></i><i></i></span>${esc(m.text)}</div>`;
    if (m.role === "error") return `<div class="gai-msg error">⚠ ${esc(m.text)}</div>`;
    if (m.role === "note") return `<div class="gai-msg note">${esc(m.text)}</div>`;
    if (m.type === "cards") {
      return `<div class="gai-msg model"><p class="gai-cards-title"><b>${esc(m.title)}</b></p><div class="pcards">` +
        m.items.map((p, j) => `<div class="pcard" data-m="${i}" data-j="${j}">
          <div class="pc-top"><b class="pc-phrase">${esc(p.phrase)}</b>${p.ipa ? ` <span class="muted">${esc(p.ipa)}</span>` : ""}</div>
          <div class="pc-mean">${esc(p.meaning)}</div>
          ${p.note ? `<div class="pc-note">${esc(p.note)}</div>` : ""}
          ${p.example ? `<div class="pc-ex">“${esc(p.example)}”</div>` : ""}
          <div class="pc-actions"><button type="button" class="btn small" data-pc="listen">🔊 Nghe</button><button type="button" class="btn small" data-pc="ex">🔊 Câu ví dụ</button><button type="button" class="btn small" data-pc="say">🎙️ Nói thử</button><span class="pc-score"></span></div>
        </div>`).join("") + `</div>${actionsRow(i)}</div>`;
    }
    return `<div class="gai-msg model"><div class="gai-text">${md(m.text)}</div>${actionsRow(i)}</div>`;
  }
  const actionsRow = (i) => `<div class="gai-acts" data-m="${i}">
    <button type="button" data-act="copy" title="Chép"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button>
    <button type="button" data-act="speak" title="Đọc to"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg></button>
  </div>`;

  // ---------- Google AI Mode (no key): same questions, answered on google.com in a new tab ----------
  function aiModeContext(kind, item) {
    if (kind === "video") return `video YouTube này: ${item.url} (tên: "${item.title}"${item.channel ? `, kênh ${item.channel}` : ""})`;
    if (kind === "article") return `bài báo này: ${item.url} (tên: "${item.title}")`;
    return `bài phát biểu tiếng Anh này:\n"""\n${item.text}\n"""`;
  }
  const AI_MODE_ASK = {
    phrases3: "Chọn 3 cụm từ tiếng Anh hay nhất, dùng được trong giao tiếp hằng ngày. Với mỗi cụm: nghĩa tiếng Việt, khi nào dùng, và một câu ví dụ.",
    phrases5: "Chọn 3–5 câu hoặc cụm từ tiếng Anh hay nhất, thường dùng trong đời sống, đáng để luyện nói thành tiếng. Với mỗi câu: nghĩa tiếng Việt, khi nào dùng, và một câu ví dụ.",
    vocab: "Chọn 8 từ mới hữu ích cho người học trình độ trung cấp. Với mỗi từ: phiên âm IPA, nghĩa tiếng Việt, và câu ví dụ trong bài.",
    summary: ACTIONS.summary.ask,
    transcript: "Cho tôi lời thoại (transcript) tiếng Anh đầy đủ của video này.",
    critique: "Đóng vai huấn luyện viên diễn thuyết giỏi nhất: góp ý bài phát biểu (mở đầu, câu chuyện, nhịp điệu, kết thúc, lời kêu gọi), và viết lại 3 câu yếu cho hay hơn. Trả lời bằng tiếng Việt, ví dụ bằng tiếng Anh.",
    delivery: "Hướng dẫn tôi cách nói bài này: chỗ ngắt nghỉ (đánh dấu /), từ cần nhấn (VIẾT HOA), cảm xúc và tốc độ từng đoạn, và những từ người Việt hay phát âm sai.",
    live: null,
  };
  function aiModePrompt(kind, item, action, freeText) {
    const ctx = aiModeContext(kind, item);
    if (action === "live") return kind === "speech"
      ? `Tôi vừa luyện ${ctx}\nHãy đóng vai khán giả: hỏi tôi từng câu hỏi một bằng tiếng Anh về bài nói, chờ tôi trả lời, rồi góp ý ngắn gọn để câu trả lời rõ ràng, tự tin hơn. Bắt đầu bằng câu hỏi đầu tiên.`
      : `Hãy luyện nói tiếng Anh với tôi về ${ctx}. Tôi là người Việt, trình độ trung cấp. Hỏi tôi từng câu một bằng tiếng Anh, chờ tôi trả lời, rồi sửa lỗi ngắn gọn và giúp tôi dùng các cụm từ hay trong đó. Bắt đầu bằng câu hỏi đầu tiên.`;
    const q = action ? AI_MODE_ASK[action] : freeText;
    return `Tôi đang học tiếng Anh (người Việt, trình độ trung cấp). Dựa vào ${ctx}\n\n${q}`;
  }
  // Opens AI Mode (synchronously, inside the click) and notes it in the item's chat.
  function askAiMode(kind, item, action, freeText) {
    const cut = SE.openAiMode(aiModePrompt(kind, item, action, freeText));
    const shown = action ? KINDS[kind].chips.find((c) => c[0] === action)?.[1] : freeText;
    SE.track(action === "live" ? "ai" : "chat");
    const note = "↗ Đã mở Google AI Mode trong tab mới với câu hỏi này." +
      (cut ? " Câu hỏi dài nên bị cắt bớt: nếu cần, xóa ô tìm kiếm và dán (Ctrl+V) bản đầy đủ đã chép sẵn." : "") +
      (action === "live" ? " Trên điện thoại, bấm micro trong ứng dụng Google để nói chuyện bằng giọng." : "");
    const updated = updateItem(kind, item.id, { chat: [...(item.chat || []), ...(shown ? [{ role: "user", text: shown }] : []), { role: "note", text: note }] });
    renderChat(kind, updated);
  }

  // Send a question (free text or a chip) to Gemini with the item's content as context.
  async function ask(kind, action, freeText) {
    const id = ui[kind].open;
    let item = getItem(kind, id);
    if (!item) return;
    if (action === "live") { // talk by voice: ChatGPT / Gemini / AI Mode with your account, or in the app
      return window.SE_HANDOFF.open({ title: item.title, prompt: window.SE_HANDOFF.contentPrompt(kind, item),
        inApp: SE.geminiKey() ? () => startLive(kind, item) : null });
    }
    if (!SE.geminiKey()) return askAiMode(kind, item, action, freeText);
    if (action === "transcript") {
      if (kind !== "video") return;
      const msgs = [...(item.chat || []), { role: "user", text: "📝 Lời thoại" }];
      item = updateItem(kind, id, { chat: msgs });
      return run(kind, id, async (status) => {
        const t = await sourceText(kind, getItem(kind, id), status, { needCues: true });
        return { role: "model", text: "Phụ đề đã hiện **ngay dưới video** và chạy theo video. **Bấm vào một từ** (ví dụ một từ mới) để lưu vào **Sổ từ vựng**. Danh sách lời thoại đầy đủ ở mục **📝 Lời thoại**.\n\n" + t.slice(0, 400) + (t.length > 400 ? "…" : "") };
      });
    }
    const A = ACTIONS[action];
    const question = A ? A.ask : freeText;
    const shown = A ? KINDS[kind].chips.find((c) => c[0] === action)[1] : freeText;
    item = updateItem(kind, id, { chat: [...(item.chat || []), { role: "user", text: shown }] });
    SE.track("chat");
    return run(kind, id, async (status) => {
      const text = await sourceText(kind, getItem(kind, id), status);
      status("Google AI đang trả lời…");
      const cur = getItem(kind, id);
      if (A?.schema) {
        const out = await gemini({ system: systemFor(kind, cur, text), contents: [{ role: "user", parts: [{ text: question }] }], schema: A.schema });
        return { role: "model", type: "cards", title: A.label, items: (out.items || []).slice(0, 10) };
      }
      // Free chat: send recent history (cards as plain text), newest question last.
      const history = (cur.chat || []).filter((m) => m.role === "user" || m.role === "model").slice(-12, -1).map((m) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.type === "cards" ? m.title + ":\n" + m.items.map((p) => `- ${p.phrase}: ${p.meaning}`).join("\n") : m.text }],
      }));
      while (history.length && history[0].role !== "user") history.shift();
      const reply = await gemini({ system: systemFor(kind, cur, text), contents: [...history, { role: "user", parts: [{ text: question }] }] });
      return { role: "model", text: reply };
    });
  }

  // Show a status line while fn runs, then append its message (or an error) to the item's chat.
  async function run(kind, id, fn) {
    const item = getItem(kind, id);
    const log = document.querySelector(`#gai-${kind} .gai-log`);
    renderChat(kind, item);
    const st = document.createElement("div");
    st.className = "gai-msg status";
    st.innerHTML = `<span class="gai-dots"><i></i><i></i><i></i></span><span>Google AI đang suy nghĩ…</span>`;
    log?.appendChild(st);
    if (log) log.scrollTop = log.scrollHeight;
    const status = (t) => { st.lastElementChild.textContent = t; };
    setBusy(kind, true);
    let msg;
    try { msg = await fn(status); } catch (err) { msg = { role: "error", text: "Không làm được: " + err.message }; }
    setBusy(kind, false);
    const cur = getItem(kind, id);
    if (!cur) return;
    const updated = updateItem(kind, id, { chat: [...(cur.chat || []), msg] });
    if (ui[kind].open === id) renderChat(kind, updated);
  }
  function setBusy(kind, on) {
    document.querySelectorAll(`#gai-${kind} .gai-chips button, #gai-${kind} .gai-input input`).forEach((b) => { b.disabled = on; });
  }

  function startLive(kind, item) {
    const text = (kind === "video" ? item.transcript : item.text) || "";
    const prompt = kind === "speech"
      ? `You are a friendly audience member and a world-class public speaking coach. The learner (a Vietnamese speaker) has just practised this speech: "${item.title}".\nSPEECH:\n${text.slice(0, 20000)}\n\n` +
        `Ask the learner realistic audience questions about the speech, one at a time, like a Q&A after a talk. Listen to each answer, then give one short tip to make it clearer or more confident (grammar, word choice, structure), and ask the next question. ` +
        `Keep your turns short. Speak clear, natural English. Start by saying "Great talk!" and asking your first question.`
      : `You are a friendly English conversation partner for a Vietnamese learner (intermediate). The learner just ${kind === "video" ? "watched the news video" : "read the news article"} "${item.title}".\n` +
        (text ? `CONTENT:\n${text.slice(0, 20000)}\n\n` : "") +
        `Talk with the learner about it: ask one question at a time about the news and their opinion, help them reuse good phrases from the content, and gently correct clear mistakes ("You can say: ..."). ` +
        `Keep your turns short (one or two sentences). Speak clear, natural English, slightly slower than normal. Start with a short greeting and your first question.`;
    window.SE_LIVE.openCustom(item.title, prompt);
  }

  // Phrase card buttons: listen, listen to the example, say it and get a score.
  async function onCardClick(kind, btn) {
    const card = btn.closest(".pcard");
    const item = getItem(kind, ui[kind].open);
    const m = item?.chat?.[+card.dataset.m];
    const p = m?.items?.[+card.dataset.j];
    if (!p) return;
    const what = btn.dataset.pc;
    if (what === "listen") { SE.track("phrase"); return SE.say(p.phrase); }
    if (what === "ex") return SE.say(p.example || p.phrase);
    if (!SE.hasRecognition) return toast("Trình duyệt này không chấm điểm được. Hãy dùng Chrome hoặc Edge.");
    SE.track("phrase");
    const out = card.querySelector(".pc-score");
    btn.classList.add("on");
    btn.textContent = "🎙️ Đang nghe…";
    const res = await SE.listenOnce(8000, p.phrase, (t) => { out.textContent = t; });
    btn.classList.remove("on");
    btn.textContent = "🎙️ Nói thử";
    if (!res.text) { out.textContent = res.error === "not-allowed" ? "Micro bị chặn." : "Chưa nghe thấy gì, thử lại nhé."; return; }
    const r = SE.compareWords(p.phrase, res.text);
    SE.trackScore(r.score);
    out.innerHTML = `<span class="badge ${r.score >= 80 ? "good" : r.score >= 60 ? "ok" : "low"}">${r.score}%</span> <span class="diff-mini">${r.html}</span>`;
  }

  function onChatAction(kind, btn) {
    const item = getItem(kind, ui[kind].open);
    const m = item?.chat?.[+btn.closest(".gai-acts").dataset.m];
    if (!m) return;
    const text = m.type === "cards" ? m.items.map((p) => `${p.phrase} – ${p.meaning}\n${p.example || ""}`).join("\n\n") : m.text.replace(/\*\*/g, "");
    if (btn.dataset.act === "copy") { navigator.clipboard?.writeText(text).then(() => toast("Đã chép"), () => {}); }
    else SE.say(m.type === "cards" ? m.items.map((p) => p.phrase).join(". ") : englishOnly(text));
  }
  // Read aloud only the English parts of a mixed Vietnamese/English answer (the voice is English).
  const englishOnly = (t) => {
    const parts = t.split(/\n+/).filter((l) => !/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(l));
    return parts.join(". ") || t;
  };

  // Dictation into the chat box.
  function dictate(kind, btn) {
    const box = btn.closest(".gai-input").querySelector("input");
    const lang = btn.closest(".gai-pill").querySelector(".gai-lang").textContent === "VI" ? "vi-VN" : "en-US";
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!R) return toast("Trình duyệt này không nhận giọng nói. Hãy dùng Chrome hoặc Edge.");
    if (btn.classList.contains("on")) { dictate.r?.stop(); return; }
    const r = (dictate.r = new R());
    r.lang = lang;
    r.interimResults = true;
    btn.classList.add("on");
    r.onresult = (e) => { box.value = [...e.results].map((x) => x[0].transcript).join(" "); };
    r.onend = () => { btn.classList.remove("on"); if (box.value.trim()) btn.closest("form").requestSubmit(); };
    r.onerror = () => btn.classList.remove("on");
    r.start();
  }

  function wireChat(kind) {
    const root = $("gai-" + kind);
    if (!root) return;
    root.querySelector(".gai-chips").onclick = (e) => { const b = e.target.closest("button[data-a]"); if (b) ask(kind, b.dataset.a); };
    root.querySelector(".gai-input").onsubmit = (e) => {
      e.preventDefault();
      const inp = e.target.querySelector("input");
      const q = inp.value.trim();
      if (!q) return;
      inp.value = "";
      ask(kind, null, q);
    };
    root.querySelector(".gai-mic").onclick = (e) => dictate(kind, e.currentTarget);
    root.querySelector(".gai-lang").onclick = (e) => { e.currentTarget.textContent = e.currentTarget.textContent === "EN" ? "VI" : "EN"; };
    root.querySelector(".gai-live").onclick = () => ask(kind, "live");
    root.querySelector("[data-key]")?.addEventListener("click", SE.openSettings);
    // Always available, also with a key: ask the typed question (or a general one) in Google AI Mode.
    root.querySelector(".gai-aimode").onclick = () => {
      const inp = root.querySelector(".gai-input input");
      const q = inp.value.trim() || "Giải thích ý chính thật dễ hiểu, chỉ ra các cụm từ tiếng Anh hay nên học, và gợi ý cách tôi luyện nói về nội dung này.";
      inp.value = "";
      askAiMode(kind, getItem(kind, ui[kind].open), null, q);
    };
    root.querySelector(".gai-clear").onclick = () => {
      if (!confirm("Xóa cuộc trò chuyện với Google AI của mục này?")) return;
      renderChat(kind, updateItem(kind, ui[kind].open, { chat: [] }));
    };
    root.querySelector(".gai-log").onclick = (e) => {
      const pc = e.target.closest("button[data-pc]");
      if (pc) return onCardClick(kind, pc);
      const act = e.target.closest("button[data-act]");
      if (act) onChatAction(kind, act);
    };
  }

  // ---------- Section rendering ----------
  function render(kind) {
    const k = KINDS[kind];
    const root = $("view-" + kind);
    if (ui[kind].open && !getItem(kind, ui[kind].open)) ui[kind].open = null;
    const head = `<div class="vhead"><div><p class="eyebrow">${k.eyebrow}</p><h2>${k.h2}</h2><p class="hint">${k.hint}</p></div>
      ${kind === "speech" ? `<div class="today-box" id="speechToday"></div>` : ""}</div>`;
    if (ui[kind].open) {
      root.innerHTML = head + `<div class="toolbar"><button class="btn" data-back>← Danh sách ${k.unit === "video" ? "video" : "bài"}</button></div><div id="detail-${kind}"></div>`;
      root.querySelector("[data-back]").onclick = () => { ui[kind].open = null; SE.endSession(); stopPlayer(); render(kind); };
      renderDetail(kind);
    } else {
      root.innerHTML = head + addPanel(kind) + `
        <div class="lib-tools"><div class="search"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>
          <input class="input" type="search" placeholder="Tìm theo tên…" value="${esc(ui[kind].q)}" /></div>
          <span class="muted small" data-count></span></div>
        <div class="cards cards-${kind}"></div>`;
      wireAdd(kind);
      const search = root.querySelector(".search input");
      search.oninput = () => { ui[kind].q = search.value; renderCards(kind); };
      renderCards(kind);
    }
    if (kind === "speech") renderToday();
  }

  // "⭐ Lưu vào LearningEnglish" bookmark (bookmarklet): works on YouTube and news sites in any browser,
  // nothing to install or update. It opens the online app with the item in the address (#add=…).
  function bookmarklet() {
    var APP = "https://lilypham7811.github.io/LearningEnglish/";
    if (location.href.indexOf(APP) === 0 || location.hostname === "localhost") {
      alert("Kéo nút này lên thanh dấu trang. Sau đó bấm nó khi đang xem video YouTube hoặc đọc bài báo.");
      return;
    }
    var sel = String(getSelection()).replace(/\s+/g, " ").trim();
    var v = document.querySelector("video");
    var t = v ? Math.floor(v.currentTime) : null;
    var title = document.title.replace(/^\(\d+\)\s*/, "").replace(/ - YouTube$/, "");
    var id = (location.href.match(/[?&]v=([\w-]{11})/) || location.href.match(/(?:shorts|embed|youtu\.be)\/([\w-]{11})/) || [])[1];
    var items;
    if (sel && sel.split(" ").length <= 5) {
      var n = getSelection().anchorNode, el = n && (n.nodeType === 3 ? n.parentElement : n), ctx = "";
      for (; el && el !== document.body; el = el.parentElement) {
        var tx = (el.innerText || "").replace(/\s+/g, " ").trim();
        if (tx.length >= 15) { ctx = tx.slice(0, 400); break; }
      }
      items = [{ kind: "word", word: sel, context: ctx, sourceKind: id ? "video" : "article", sourceTitle: title,
        sourceUrl: id ? "https://www.youtube.com/watch?v=" + id + (t != null ? "&t=" + t + "s" : "") : location.href, time: t }];
    } else if (id) {
      items = [{ url: "https://www.youtube.com/watch?v=" + id, title: title }];
    } else {
      var meta = function (p) { var m = document.querySelector('meta[property="' + p + '"],meta[name="' + p + '"]'); return m ? m.content : ""; };
      var root = document.querySelector("article") || document.querySelector("main") || document.body;
      var ps = [].slice.call(root.querySelectorAll("p")).map(function (p) { return p.innerText.trim(); })
        .filter(function (x) { return x.split(/\s+/).length >= 8; });
      items = [{ kind: "article", url: location.href, title: meta("og:title") || title, site: meta("og:site_name") || location.hostname.replace(/^www\./, ""),
        image: meta("og:image"), excerpt: meta("og:description"), text: ps.join("\n\n").slice(0, 20000) }];
    }
    window.open(APP + "#add=" + encodeURIComponent(JSON.stringify({ at: Date.now(), items: items })), "shadowenglish");
  }
  const BOOKMARKLET = "javascript:" + encodeURIComponent("(" + bookmarklet.toString() + ")()");

  function addPanel(kind) {
    if (kind === "speech") return `<div class="panel"><div class="panel-head"><h3>Thêm bài phát biểu</h3>
        <div class="seg" data-tabs><button type="button" data-t="ai" aria-pressed="true">✨ Nhờ AI viết</button><button type="button" data-t="paste" aria-pressed="false">📋 Dán bài</button></div></div>
      <div class="panel-body">
        <form class="addform" data-form="ai">
          <input class="input" name="topic" required placeholder="Chủ đề: vì sao nên học suốt đời, giới thiệu bản thân khi phỏng vấn, chúc mừng đám cưới bạn thân…" />
          <div class="addrow">
            <select class="select" name="type">
              <option value="an inspiring, motivational speech">Truyền cảm hứng</option>
              <option value="a TED-style talk with a personal story and one big idea">Kiểu TED Talk</option>
              <option value="a persuasive speech">Thuyết phục</option>
              <option value="a professional business presentation opening">Thuyết trình công việc</option>
              <option value="a confident self-introduction">Giới thiệu bản thân</option>
              <option value="a warm toast for a wedding or celebration">Chúc mừng / nâng ly</option>
              <option value="a short graduation or award acceptance speech">Tốt nghiệp / nhận giải</option>
            </select>
            <select class="select" name="minutes"><option value="1">1 phút</option><option value="2" selected>2 phút</option><option value="3">3 phút</option><option value="5">5 phút</option></select>
            <select class="select" name="level"><option value="Intermediate">Trung cấp</option><option value="Advanced" selected>Nâng cao</option><option value="Beginner">Cơ bản</option></select>
            <button class="btn primary">✨ Viết bài</button>
          </div>
          <p class="hint small" data-status></p>
        </form>
        <form class="addform" data-form="paste" hidden>
          <input class="input" name="title" placeholder="Tên bài (không bắt buộc)" />
          <textarea class="input" name="text" rows="7" required placeholder="Dán bài phát biểu tiếng Anh vào đây…"></textarea>
          <div class="addrow"><button class="btn primary">＋ Lưu bài</button></div>
        </form>
      </div></div>`;
    const ph = kind === "video" ? "Dán link YouTube: https://www.youtube.com/watch?v=…" : "Dán link bài báo: https://…";
    return `<div class="panel"><div class="panel-body">
      <form class="addform" data-form="url"><div class="addrow">
        <input class="input" name="url" type="url" required placeholder="${ph}" />
        <button class="btn primary">＋ Lưu ${kind === "video" ? "video" : "bài báo"}</button></div>
        ${kind === "article" ? `<details class="paste-more"><summary>Dán thêm nội dung bài (nếu trang cần đăng nhập)</summary><textarea class="input" name="text" rows="5" placeholder="Dán nội dung bài báo…"></textarea></details>` : ""}
      </form>
      <div class="bm-box">
        <a class="bm-link" href="${BOOKMARKLET}" title="Kéo lên thanh dấu trang" draggable="true">⭐ Lưu vào LearningEnglish</a>
        <div class="hint small"><b>Cách dễ nhất, không cần cài gì:</b> kéo nút xanh này lên <b>thanh dấu trang</b> của trình duyệt (nếu chưa thấy thanh dấu trang: nhấn <b>Ctrl+Shift+B</b>).
          Sau đó, khi đang xem video YouTube hoặc đọc bài báo, bấm nút đó trên thanh dấu trang là bài được lưu vào đây.
          Bôi đen một từ rồi bấm thì lưu từ đó vào Sổ từ vựng.</div>
      </div>
      <details class="ext-help"><summary>🧩 Hoặc dùng tiện ích chuột phải “Save to LearningEnglish” (Chrome / Edge)</summary>
        <ol>
          <li>Mở <code>chrome://extensions</code> (Edge: <code>edge://extensions</code>) và bật <b>Developer mode</b> (Chế độ nhà phát triển).</li>
          <li>Bấm <b>Load unpacked</b> và chọn thư mục <code>extension</code> trong thư mục app này.</li>
          <li>Mở video YouTube hoặc bài báo, bấm chuột phải vào trang (trên YouTube: bấm vào chỗ trống ngoài khung video) → <b>Save to LearningEnglish</b>. Hoặc bấm biểu tượng tiện ích, hoặc phím <b>Alt+Shift+S</b>.</li>
          <li>Bài được lưu vào app online (lilypham7811.github.io/LearningEnglish). Nếu app chưa mở, tiện ích sẽ tự mở và lưu.</li>
        </ol>
      </details>
    </div></div>`;
  }

  function wireAdd(kind) {
    const root = $("view-" + kind);
    const tabs = root.querySelector("[data-tabs]");
    if (tabs) tabs.onclick = (e) => {
      const b = e.target.closest("button[data-t]");
      if (!b) return;
      tabs.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      root.querySelectorAll("[data-form]").forEach((f) => { f.hidden = f.dataset.form !== b.dataset.t; });
    };
    root.querySelectorAll("form.addform").forEach((f) => {
      f.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(f);
        const btn = f.querySelector("button.primary");
        if (f.dataset.form === "url") {
          const url = fd.get("url").trim();
          if (kind === "video" && !youtubeId(url)) return toast("Đây không phải link YouTube.");
          btn.disabled = true;
          await addItem({ kind, url, text: (fd.get("text") || "").trim() }, { open: true });
          btn.disabled = false;
        } else if (f.dataset.form === "paste") {
          const text = fd.get("text").trim();
          if (!text) return;
          const title = fd.get("title").trim() || text.split(/[.!?\n]/)[0].slice(0, 70);
          await addItem({ kind: "speech", title, text, source: "Dán vào" }, { open: true });
        } else if (!SE.geminiKey()) {
          // No key: have Google AI Mode write it, then paste it back here.
          const st = f.querySelector("[data-status]");
          SE.openAiMode(speechPrompt(fd.get("topic").trim(), fd.get("type"), +fd.get("minutes"), fd.get("level")) +
            "\n\nViết bài bằng tiếng Anh. Dòng đầu là tên bài. Sau bài, thêm 3 mẹo trình bày bằng tiếng Việt.");
          root.querySelector('[data-t="paste"]').click();
          toast("Đã mở Google AI Mode. Viết xong thì chép bài và dán vào ô này.");
          st.textContent = "";
        } else {
          const st = f.querySelector("[data-status]");
          btn.disabled = true;
          btn.textContent = "Đang viết…";
          st.textContent = "Google AI đang viết bài phát biểu…";
          try {
            const sp = await writeSpeech(fd.get("topic").trim(), fd.get("type"), +fd.get("minutes"), fd.get("level"));
            await addItem({ kind: "speech", ...sp, source: "Google AI" }, { open: true });
          } catch (err) {
            st.textContent = "⚠ Không viết được: " + err.message;
          } finally {
            btn.disabled = false;
            btn.textContent = "✨ Viết bài";
          }
        }
      };
    });
  }

  function renderCards(kind) {
    const root = $("view-" + kind);
    const box = root.querySelector(".cards");
    if (!box) return;
    const q = ui[kind].q.trim().toLowerCase();
    const items = list(kind).filter((x) => !q || (x.title + " " + (x.channel || x.site || "")).toLowerCase().includes(q));
    root.querySelector("[data-count]").textContent = `${items.length} ${KINDS[kind].unit}`;
    if (!items.length) { box.innerHTML = `<div class="panel empty"><b>${q ? "Không tìm thấy" : "Danh sách trống"}</b><span>${q ? "Thử từ khóa khác." : KINDS[kind].empty}</span></div>`; return; }
    box.innerHTML = items.map((x) => {
      if (kind === "video") return `<article class="card" data-id="${x.id}">
        <button class="card-open thumb" data-open aria-label="Mở"><img src="${thumb(x.videoId)}" alt="" loading="lazy" /><span class="play-ico">▶</span></button>
        <div class="card-body"><button class="card-title" data-open>${esc(x.title)}</button>
          <div class="card-meta">${esc(x.channel || "YouTube")} · ${dateVi(x.savedAt)}${x.chat?.length ? ` · <span class="chip ai">✨ ${x.chat.filter((m) => m.role === "model").length} trả lời AI</span>` : ""}</div>
          <div class="card-acts"><a class="btn small" href="${esc(x.url)}" target="_blank" rel="noopener" data-link>↗ Mở YouTube</a><button class="btn small primary" data-open>✨ Học với AI</button><button class="btn small ghost danger" data-del title="Xóa">🗑</button></div></div></article>`;
      if (kind === "article") return `<article class="card" data-id="${x.id}">
        ${x.image ? `<button class="card-open thumb" data-open aria-label="Mở"><img src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" /></button>` : ""}
        <div class="card-body"><span class="chip">${esc(x.site || hostOf(x.url))}</span>
          <button class="card-title" data-open>${esc(x.title)}</button>
          <p class="card-ex">${esc(x.excerpt || "")}</p>
          <div class="card-meta">${dateVi(x.savedAt)}${x.text ? ` · ${words(x.text)} từ` : " · chưa có nội dung"}</div>
          <div class="card-acts"><a class="btn small" href="${esc(x.url)}" target="_blank" rel="noopener" data-link>↗ Bài gốc</a><button class="btn small primary" data-open>📖 Đọc & học</button><button class="btn small ghost danger" data-del title="Xóa">🗑</button></div></div></article>`;
      const n = words(x.text);
      return `<article class="card" data-id="${x.id}"><div class="card-body">
        <span class="chip ${x.source === "Google AI" ? "ai" : ""}">${esc(x.source || "")}</span>
        <button class="card-title" data-open>${esc(x.title)}</button>
        <p class="card-ex">${esc(x.text.slice(0, 180))}…</p>
        <div class="card-meta">${n} từ · ~${Math.max(1, Math.round(n / 130))} phút · đã luyện ${practiceCount(x.id)} lần</div>
        <div class="card-acts"><button class="btn small primary" data-open>🎤 Luyện bài này</button><button class="btn small ghost danger" data-del title="Xóa">🗑</button></div></div></article>`;
    }).join("");
    box.onclick = (e) => {
      const card = e.target.closest(".card");
      if (!card) return;
      if (e.target.closest("[data-link]")) { return; }
      if (e.target.closest("[data-del]")) {
        const it = getItem(kind, card.dataset.id);
        if (it && confirm(`Xóa “${it.title}”?`)) { saveList(kind, list(kind).filter((x) => x.id !== it.id)); renderCards(kind); }
        return;
      }
      if (e.target.closest("[data-open]")) openItem(kind, card.dataset.id);
    };
  }

  function openItem(kind, id) {
    const item = getItem(kind, id);
    if (!item) return;
    ui[kind].open = id;
    SE.showView(kind); // renders the section and starts timing this item (see the se:view listener)
    window.scrollTo({ top: 0 });
  }

  function renderDetail(kind) {
    const item = getItem(kind, ui[kind].open);
    const box = $("detail-" + kind);
    if (kind === "video") stopPlayer();
    if (!item || !box) return;
    box.dataset.srcKind = kind;
    box.dataset.srcTitle = item.title;
    box.dataset.srcUrl = item.url || "";
    let left = "";
    if (kind === "video") {
      left = `<div class="panel"><div class="video-frame"><div id="ytPlayer"></div></div>
        <div class="subbar" id="subBar" aria-live="polite"></div>
        <form class="quick-word" id="quickWord" autocomplete="off">
          <input class="input" name="w" placeholder="Thấy từ hay trên phụ đề? Gõ vào đây rồi Enter để lưu (vd: laudable)" />
          <button class="btn primary">⭐ Lưu từ</button>
        </form>
        <div class="panel-body"><h3 class="d-title">${esc(item.title)}</h3><div class="card-meta">${esc(item.channel || "YouTube")} · lưu ngày ${dateVi(item.savedAt)}</div>
        <div class="toolbar d-acts"><a class="btn" href="${esc(item.url)}" target="_blank" rel="noopener" data-open-link>↗ Mở trên YouTube</a><button class="btn ghost danger" data-del>🗑 Xóa</button></div>
        <div id="transcriptBox"></div></div></div>`;
    } else if (kind === "article") {
      left = `<div class="panel reader"><div class="panel-body">
        <span class="chip">${esc(item.site || hostOf(item.url))}</span>
        <h3 class="d-title">${esc(item.title)}</h3><div class="card-meta">Lưu ngày ${dateVi(item.savedAt)}${item.text ? ` · ${words(item.text)} từ · ~${Math.max(1, Math.round(words(item.text) / 200))} phút đọc` : ""}</div>
        <div class="toolbar d-acts"><a class="btn" href="${esc(item.url)}" target="_blank" rel="noopener" data-open-link>↗ Mở bài gốc</a><button class="btn ghost danger" data-del>🗑 Xóa</button></div>
        ${item.text
          ? `<p class="hint small">💡 Bấm vào một câu để nghe đọc.</p><div class="reader-text">${paragraphs(item.text)}</div>`
          : `<div class="status warn">Chưa có nội dung bài. Bấm một gợi ý ✨ bên Google AI để AI tự đọc bài từ link, hoặc dán nội dung vào đây:</div>
             <textarea class="input" rows="6" data-paste placeholder="Dán nội dung bài báo…"></textarea><div class="toolbar"><button class="btn primary" data-save-text>Lưu nội dung</button></div>`}
      </div></div>`;
    } else {
      const n = words(item.text);
      left = `<div class="panel"><div class="panel-body">
        <span class="chip ${item.source === "Google AI" ? "ai" : ""}">${esc(item.source || "")}</span>
        <h3 class="d-title">${esc(item.title)}</h3>
        <div class="card-meta">${n} từ · nói khoảng ${Math.max(1, Math.round(n / 130))} phút · đã luyện <b>${practiceCount(item.id)}</b> lần</div>
        <div class="toolbar d-acts">
          <button class="btn primary" data-prompter>📜 Đọc chạy chữ</button>
          <button class="btn" data-model>🔊 Nghe mẫu</button>
          <button class="btn record" data-rec>🎙️ Ghi âm &amp; AI nhận xét</button>
          <button class="btn ghost" data-edit>✏️ Sửa</button>
          <button class="btn ghost danger" data-del>🗑</button>
        </div>
        <div class="rec-box" data-recbox hidden></div>
        ${item.tips ? `<div class="status"><b>💡 Mẹo trình bày:</b> ${esc(item.tips)}</div>` : ""}
        <div class="speech-text" data-text>${paragraphs(item.text)}</div>
      </div></div>`;
    }
    box.innerHTML = `<div class="detail-grid"><div class="detail-main">${left}</div><aside class="detail-ai">${chatHtml(kind)}</aside></div>`;
    wireChat(kind);
    renderChat(kind, item);
    if (kind === "video") { renderTranscript(item); startPlayer(item); }
    wireDetail(kind, item);
  }

  function paragraphs(text) {
    return text.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean)
      .map((p) => `<p>${(p.match(/[^.!?]+[.!?]+["”’)]*|[^.!?]+$/g) || [p]).map((s) => `<span class="sent">${esc(s.trim())}</span>`).join(" ")}</p>`).join("");
  }
  // ---------- Video: clickable subtitles that follow the video ----------
  // Cues = [{ t: seconds, text }]. They come from Google AI (timestamped transcript) or from the
  // transcript the learner copies from YouTube ("Show transcript"), so this works without a key too.
  const fmtT = (s) => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`; };
  const toSec = (str) => str.split(":").map(Number).reduce((a, n) => a * 60 + n, 0);
  const cuesText = (cues) => cues.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim();
  function parseCues(raw) {
    const cues = [];
    let t = null;
    for (let line of raw.split(/\r?\n/)) {
      line = line.replace(/\*\*/g, "").trim();
      if (!line) continue;
      let m = line.match(/^\[?((?:\d+:)?\d{1,2}:\d{2})\]?\s*[-–:]?\s*(.*)$/); // "[0:12] text", "0:12 text" or "0:12" alone
      if (m && /^\d/.test(line.replace("[", ""))) {
        t = toSec(m[1]);
        if (m[2] && !/^\d+\s*(seconds?|minutes?|giây|phút)/i.test(m[2])) cues.push({ t, text: m[2] });
        continue;
      }
      if (t == null || /^\d+\s*(seconds?|minutes?|giây|phút)/i.test(line)) continue; // YouTube adds "12 seconds" under each time
      const last = cues[cues.length - 1];
      if (last && last.t === t) last.text += " " + line; else cues.push({ t, text: line });
    }
    return cues.filter((c) => /[a-z]/i.test(c.text)).sort((a, b) => a.t - b.t);
  }
  const wordSpans = (text) => text.split(/(\s+)/).map((tok) => (/[a-z]/i.test(tok) ? `<span class="w2">${esc(tok)}</span>` : esc(tok))).join("");

  function renderTranscript(item) {
    const box = $("transcriptBox");
    if (!box) return;
    if (item.cues?.length) {
      box.innerHTML = `<details class="transcript" open><summary>📝 Lời thoại <span class="muted small">(bấm thời gian để tua, bấm một từ để lưu)</span></summary>
        <div class="cues">${item.cues.map((c, i) => `<div class="cue" data-i="${i}"><button type="button" class="cue-t" data-t="${c.t}">${fmtT(c.t)}</button><span class="cue-x">${wordSpans(c.text)}</span></div>`).join("")}</div></details>`;
      return;
    }
    box.innerHTML = `<div class="sub-setup">
      <b>💬 Phụ đề bấm được chữ</b>
      <p class="hint small">Để bấm vào một từ trong phụ đề (ví dụ <i>laudable</i>) và lưu vào Sổ từ vựng, app cần lời thoại có thời gian:</p>
      ${SE.geminiKey() ? `<button type="button" class="btn primary" data-make-subs>✨ Tạo phụ đề bằng Google AI</button>` : ""}
      <details class="paste-more" ${SE.geminiKey() ? "" : "open"}><summary>📋 Dán lời thoại từ YouTube (không cần khoá)</summary>
        <ol class="hint small"><li>Mở video trên YouTube (máy tính), bấm <b>…thêm</b> dưới video → <b>Hiện bản chép lời</b> (Show transcript).</li>
          <li>Bấm vào khung lời thoại bên phải, kéo chọn từ đầu đến cuối (hoặc Ctrl+A trong khung), Ctrl+C.</li>
          <li>Dán vào ô dưới, bấm <b>Lưu phụ đề</b>.</li></ol>
        <textarea class="input" rows="5" data-cues-paste placeholder="0:00&#10;Good evening and welcome…&#10;0:04&#10;The university merger…"></textarea>
        <div class="toolbar"><button type="button" class="btn" data-cues-save>Lưu phụ đề</button><span class="hint small" data-cues-msg></span></div>
      </details>
      ${item.transcript ? `<details class="transcript"><summary>📝 Lời thoại cũ (chưa có thời gian)</summary><div class="reader-text">${paragraphs(item.transcript)}</div></details>` : ""}
    </div>`;
    box.querySelector("[data-make-subs]")?.addEventListener("click", () => ask("video", "transcript"));
    box.querySelector("[data-cues-save]").onclick = () => {
      const cues = parseCues(box.querySelector("[data-cues-paste]").value);
      if (cues.length < 2) { box.querySelector("[data-cues-msg]").textContent = "Chưa đọc được. Cần có cả dòng thời gian (0:12) và dòng chữ."; return; }
      Object.assign(item, updateItem("video", item.id, { cues, transcript: cuesText(cues) }));
      renderTranscript(item);
      toast(`✓ Đã lưu phụ đề (${cues.length} câu). Bấm ▶ để xem, bấm một từ để lưu.`);
    };
  }

  // YouTube player through the IFrame API, so the app knows the current time.
  const yt = { player: null, timer: 0, item: null, cur: -1 };
  let ytApi = null;
  function loadYtApi() {
    if (window.YT?.Player) return Promise.resolve();
    ytApi ||= new Promise((res) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); res(); };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    });
    return ytApi;
  }
  async function startPlayer(item) {
    yt.item = item;
    yt.cur = -1;
    await loadYtApi();
    if (yt.item !== item || !$("ytPlayer")) return;
    yt.player = new YT.Player("ytPlayer", {
      videoId: item.videoId,
      host: "https://www.youtube-nocookie.com",
      playerVars: { rel: 0, playsinline: 1, modestbranding: 1 },
      events: { onStateChange: (e) => { window.SE_BUSY = e.data === 1; } },
    });
    yt.timer = setInterval(syncSubs, 250);
    syncSubs();
  }
  function stopPlayer() {
    clearInterval(yt.timer);
    try { yt.player?.destroy(); } catch {}
    yt.player = null;
    yt.item = null;
    window.SE_BUSY = false;
  }
  const nowT = () => { try { return yt.player?.getCurrentTime?.() || 0; } catch { return 0; } };
  function syncSubs() {
    const bar = $("subBar");
    if (!bar || !yt.item) return stopPlayer();
    const cues = getItem("video", yt.item.id)?.cues || [];
    if (!cues.length) { bar.innerHTML = `<span class="sub-empty">Chưa có phụ đề bấm được. Xem hướng dẫn ở mục 💬 bên dưới.</span>`; return; }
    const t = nowT() + 0.2;
    let i = -1;
    for (let k = 0; k < cues.length && cues[k].t <= t; k++) i = k;
    if (i === yt.cur) return;
    yt.cur = i;
    bar.innerHTML = i < 0 ? `<span class="sub-empty">Bấm ▶ để xem. Phụ đề sẽ hiện ở đây, bấm một từ để lưu.</span>` : `<span class="sub-line">${wordSpans(cues[i].text)}</span>`;
    const list = document.querySelector("#transcriptBox .cues");
    list?.querySelectorAll(".cue.on").forEach((x) => x.classList.remove("on"));
    const row = list?.querySelector(`.cue[data-i="${i}"]`);
    if (row) { row.classList.add("on"); list.scrollTo({ top: row.offsetTop - list.offsetTop - 40, behavior: "smooth" }); }
  }
  // A word in the subtitle bar or transcript: pause, then offer to save it with its sentence and time.
  function onSubWord(el) {
    const cueEl = el.closest(".cue");
    const cues = getItem("video", yt.item?.id)?.cues || [];
    const cue = cueEl ? cues[+cueEl.dataset.i] : cues[yt.cur];
    const t = cue ? cue.t : nowT();
    try { yt.player?.pauseVideo(); } catch {}
    const item = yt.item;
    window.SE_WORDS?.popover(el, {
      word: el.textContent,
      context: cue?.text || "",
      sourceKind: "video",
      sourceTitle: item.title,
      sourceUrl: `${item.url}&t=${Math.floor(t)}s`,
      sourceId: item.id,
      time: t,
    });
  }

  function wireDetail(kind, item) {
    const box = $("detail-" + kind);
    box.querySelector("[data-open-link]")?.addEventListener("click", () => SE.track("open"));
    box.querySelector("[data-del]").onclick = () => {
      if (!confirm(`Xóa “${item.title}”?`)) return;
      saveList(kind, list(kind).filter((x) => x.id !== item.id));
      ui[kind].open = null;
      SE.endSession();
      render(kind);
    };
    // Type a word seen on the video (eJOY / YouTube subtitles) to save it with the current second.
    box.querySelector("#quickWord")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const word = e.target.w.value.trim();
      if (!word) return;
      const t = nowT();
      const cues = getItem("video", item.id)?.cues || [];
      let i = -1;
      for (let k = 0; k < cues.length && cues[k].t <= t + 0.2; k++) i = k;
      const near = [cues[i], cues[i - 1], cues[i + 1]].find((c) => c?.text.toLowerCase().includes(word.toLowerCase()));
      window.SE_WORDS.save({ word, context: near?.text || "", sourceKind: "video", sourceTitle: item.title,
        sourceUrl: `${item.url}&t=${Math.floor(t)}s`, sourceId: item.id, time: t });
      e.target.w.value = "";
    });
    // Video subtitles: click a word to save it, click a time to jump there.
    box.querySelector(".detail-main").addEventListener("click", (e) => {
      const w = e.target.closest(".w2");
      if (w) return onSubWord(w);
      const tb = e.target.closest(".cue-t");
      if (tb) { try { yt.player?.seekTo(+tb.dataset.t, true); yt.player?.playVideo(); } catch {} }
    });
    // Click a sentence to hear it.
    box.querySelector(".detail-main").addEventListener("click", (e) => {
      const s = e.target.closest(".sent");
      if (!s || getSelection().toString().trim()) return; // selecting a word to save it, not listening
      box.querySelectorAll(".sent.on").forEach((x) => x.classList.remove("on"));
      s.classList.add("on");
      SE.track("read");
      SE.say(s.textContent).then(() => s.classList.remove("on"));
    });
    const saveText = box.querySelector("[data-save-text]");
    if (saveText) saveText.onclick = () => {
      const t = box.querySelector("[data-paste]").value.trim();
      if (!t) return;
      updateItem(kind, item.id, { text: t.slice(0, 40000), excerpt: t.slice(0, 260) });
      renderDetail(kind);
    };
    if (kind !== "speech") return;
    box.querySelector("[data-prompter]").onclick = () => openPrompter(item);
    box.querySelector("[data-model]").onclick = async (e) => {
      const b = e.currentTarget;
      if (b.dataset.on) { SE.stopAll(); return; }
      b.dataset.on = "1";
      b.textContent = "■ Dừng";
      SE.track("listen");
      const sents = [...box.querySelectorAll("[data-text] .sent")];
      for (const s of sents) {
        if (!b.dataset.on) break;
        s.classList.add("on");
        s.scrollIntoView({ block: "center", behavior: "smooth" });
        const t0 = Date.now();
        await SE.say(s.textContent);
        s.classList.remove("on");
        if (Date.now() - t0 < 150) break; // cancelled
      }
      delete b.dataset.on;
      b.textContent = "🔊 Nghe mẫu";
    };
    box.querySelector("[data-rec]").onclick = (e) => toggleSpeechRecording(item, e.currentTarget);
    box.querySelector("[data-edit]").onclick = (e) => {
      const t = box.querySelector("[data-text]");
      if (e.currentTarget.dataset.on) {
        const text = t.querySelector("textarea").value.trim();
        if (text) updateItem(kind, item.id, { text });
        renderDetail(kind);
        return;
      }
      e.currentTarget.dataset.on = "1";
      e.currentTarget.textContent = "✓ Lưu";
      t.innerHTML = `<textarea class="input" rows="16">${esc(item.text)}</textarea>`;
    };
  }

  // ---------- Section 5: recording + AI feedback ----------
  let rec = null;
  async function toggleSpeechRecording(item, btn) {
    if (rec) { rec.recorder.stop(); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { return toast("Không dùng được micro. Hãy cho phép micro trong trình duyệt."); }
    SE.stopAll();
    const box = btn.closest(".panel-body").querySelector("[data-recbox]");
    const chunks = [];
    const recorder = new MediaRecorder(stream);
    rec = { recorder, start: Date.now() };
    window.SE_BUSY = true;
    btn.classList.add("on");
    btn.textContent = "⏹ Dừng ghi âm";
    box.hidden = false;
    box.innerHTML = `<span class="rec-dot"></span> Đang ghi âm… <b data-timer>0:00</b> <span class="muted small">Hãy nói cả bài như đang đứng trước khán giả.</span>`;
    const timer = setInterval(() => {
      const s = Math.round((Date.now() - rec.start) / 1000);
      box.querySelector("[data-timer]").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }, 500);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      const secs = Math.max(1, Math.round((Date.now() - rec.start) / 1000));
      rec = null;
      window.SE_BUSY = false;
      btn.classList.remove("on");
      btn.textContent = "🎙️ Ghi âm & AI nhận xét";
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      const url = URL.createObjectURL(blob);
      const wpm = Math.round(words(item.text) / (secs / 60));
      SE.track("speech");
      bumpPractice(item.id);
      box.innerHTML = `<div class="rec-done"><audio controls src="${url}"></audio>
        <span class="muted small">${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} · khoảng ${wpm} từ/phút ${wpm > 160 ? "(hơi nhanh)" : wpm < 100 ? "(hơi chậm)" : "(tốt)"}</span>
        <button class="btn primary small" data-fb>✨ Gửi Google AI nhận xét</button></div>
        ${SE.geminiKey() ? "" : `<p class="hint small" style="flex-basis:100%;margin:0">Để AI <b>nghe bản ghi âm</b> và nhận xét phát âm, cần dán khoá Google AI (miễn phí) trong Cài đặt. Google AI Mode không nghe được file ghi âm, nhưng bạn có thể bấm “🗣️ Cách nói bài này” bên Google AI.</p>`}`;
      box.querySelector("[data-fb]").onclick = (e) => {
        if (!SE.geminiKey()) return SE.openSettings();
        e.currentTarget.disabled = true;
        feedback(item, blob, secs, wpm);
      };
      renderTodayAndMeta(item);
      if (SE.geminiKey()) { box.querySelector("[data-fb]").disabled = true; feedback(item, blob, secs, wpm); }
    };
    recorder.start();
  }

  async function feedback(item, blob, secs, wpm) {
    const kind = "speech";
    const cur = getItem(kind, item.id);
    updateItem(kind, item.id, { chat: [...(cur.chat || []), { role: "user", text: `🎙️ Bản ghi âm (${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}, ~${wpm} từ/phút). Nhận xét giúp mình!` }] });
    SE.track("feedback");
    await run(kind, item.id, async (status) => {
      status("Google AI đang nghe bản ghi âm của bạn…");
      const data = await blobToBase64(blob);
      const text = await gemini({
        system: "You are a world-class public speaking and pronunciation coach for Vietnamese speakers of English. Be specific, honest and encouraging.",
        contents: [{ role: "user", parts: [
          { inlineData: { mimeType: geminiAudioType(blob.type), data } },
          { text:
            `This is my recording practising the speech below. Duration: ${secs} seconds (about ${wpm} words per minute).\n\nSCRIPT:\n${item.text}\n\n` +
            `Give feedback in Vietnamese (keep English words and examples in English), with these sections:\n` +
            `Line 1 exactly: "Điểm: N/10" (overall delivery score).\n` +
            `## Phát âm: quote the specific words I mispronounced and how to say them (watch final consonants, -s/-ed endings, "th", word stress).\n` +
            `## Tốc độ & ngắt nghỉ\n## Nhấn nhá & cảm xúc\n## Từ đệm (um, uh, like) and any part of the script I skipped or changed\n` +
            `## Làm tốt (2 points)\n## 3 bài tập cho lần sau (very concrete).` },
        ] }],
      });
      const m = text.match(/Điểm:\s*(\d+(?:[.,]\d)?)\s*\/\s*10/);
      if (m) SE.trackScore(Math.round(parseFloat(m[1].replace(",", ".")) * 10));
      return { role: "model", text };
    });
  }
  // Chrome records audio/webm; iPhone Safari records audio/mp4 (AAC), which Google AI lists as audio/m4a.
  function geminiAudioType(type) {
    const t = (type || "audio/webm").split(";")[0];
    return t === "audio/mp4" || t === "audio/x-m4a" ? "audio/m4a" : t;
  }
  const blobToBase64 = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });

  // Practice counts per speech, kept on the item.
  function bumpPractice(id) {
    const it = getItem("speech", id);
    if (it) updateItem("speech", id, { practice: (it.practice || 0) + 1, lastPractice: Date.now() });
  }
  const practiceCount = (id) => getItem("speech", id)?.practice || 0;
  function renderTodayAndMeta(item) {
    renderToday();
    const meta = document.querySelector("#detail-speech .card-meta b");
    if (meta) meta.textContent = practiceCount(item.id);
  }
  function renderToday() {
    const box = $("speechToday");
    if (!box) return;
    const log = (SE.safeGet("log") || []).filter((x) => x.kind === "speech");
    const dk = (t) => new Date(t).toDateString();
    const today = log.filter((x) => dk(x.start) === dk(Date.now()));
    const secs = today.reduce((a, x) => a + x.seconds, 0);
    const days = new Set(log.map((x) => dk(x.start)));
    let streak = 0;
    const d = new Date();
    if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
    while (days.has(d.toDateString())) { streak++; d.setDate(d.getDate() - 1); }
    const recs = today.reduce((a, x) => a + (x.acts?.speech || 0), 0);
    box.innerHTML = `<div class="kpi mini" style="--pc:var(--r6)"><div class="k-label">Hôm nay</div><div class="k-val">${recs}<small> lần nói</small></div><div class="k-foot">${Math.round(secs / 60)} phút luyện · chuỗi ${streak} ngày 🔥</div></div>`;
  }

  function speechPrompt(topic, type, minutes, level) {
    const L = SE.LEVELS[level] || SE.LEVELS.Advanced;
    return `Write ${type} in English about: "${topic}" (the topic may be written in Vietnamese). It should take about ${minutes} minute(s) to say out loud (about ${minutes * 130} words). ` +
      `Audience level: ${level} (CEFR ${L.cefr}). The speaker is a Vietnamese learner, so use clear, natural, speakable sentences. ` +
      `Make it genuinely excellent, original writing using the techniques of the best speakers: a strong opening hook, a short vivid story or example, the rule of three, rhythm and repetition, a memorable closing line and a clear call to action. ` +
      `Do not copy famous speeches. Split it into short paragraphs separated by blank lines.`;
  }
  async function writeSpeech(topic, type, minutes, level) {
    const out = await gemini({
      contents: [{ role: "user", parts: [{ text: speechPrompt(topic, type, minutes, level) +
        ` Also give a short English title and 3 delivery tips in Vietnamese (one sentence each, joined in one string).` }] }],
      schema: { type: "OBJECT", properties: { title: { type: "STRING" }, text: { type: "STRING" }, tips: { type: "STRING" } }, required: ["title", "text", "tips"] },
    });
    if (!out.text || words(out.text) < 40) throw new Error("bài viết quá ngắn, hãy thử lại.");
    return out;
  }

  // ---------- Teleprompter ----------
  const P = { item: null, raf: 0, running: false, last: 0, pos: 0 };
  function openPrompter(item) {
    SE.stopAll();
    P.item = item;
    $("prompterTitle").textContent = "· " + item.title;
    $("prompterText").innerHTML = item.text.split(/\n\s*\n|\n/).filter((p) => p.trim()).map((p) => `<p>${esc(p.trim())}</p>`).join("");
    $("prompterText").style.fontSize = $("prompterSize").value + "rem";
    $("prompter").hidden = false;
    document.body.classList.add("rp-open");
    P.pos = 0;
    $("prompterBody").scrollTop = 0;
    setPlaying(false);
    SE.track("prompter");
    updatePrompterTime();
  }
  function closePrompter() {
    setPlaying(false);
    $("prompter").hidden = true;
    document.body.classList.remove("rp-open");
  }
  function setPlaying(on) {
    P.running = on;
    window.SE_BUSY = on;
    $("prompterPlay").textContent = on ? "⏸ Tạm dừng" : "▶ Bắt đầu";
    cancelAnimationFrame(P.raf);
    if (on) { P.last = performance.now(); P.pos = $("prompterBody").scrollTop; P.raf = requestAnimationFrame(step); }
  }
  // Scroll at the chosen words-per-minute: pixels per second = (text height / word count) × words per second.
  function step(now) {
    const body = $("prompterBody");
    const n = Math.max(1, words(P.item.text));
    const pxPerWord = $("prompterText").scrollHeight / n;
    P.pos += ((now - P.last) / 1000) * pxPerWord * (+$("prompterWpm").value / 60);
    P.last = now;
    body.scrollTop = P.pos;
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 2) return setPlaying(false);
    P.raf = requestAnimationFrame(step);
  }
  function updatePrompterTime() {
    const wpm = +$("prompterWpm").value;
    $("prompterWpmVal").textContent = `${wpm} từ/phút`;
    const s = Math.round((words(P.item?.text) / wpm) * 60);
    $("prompterTime").textContent = `≈ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  $("prompterPlay").onclick = () => setPlaying(!P.running);
  $("prompterRestart").onclick = () => { $("prompterBody").scrollTop = 0; P.pos = 0; };
  $("prompterClose").onclick = closePrompter;
  $("prompterWpm").oninput = updatePrompterTime;
  $("prompterSize").oninput = () => { $("prompterText").style.fontSize = $("prompterSize").value + "rem"; };
  $("prompterBody").addEventListener("wheel", () => { if (P.running) P.pos = $("prompterBody").scrollTop; }, { passive: true });
  document.addEventListener("keydown", (e) => {
    if ($("prompter").hidden) return;
    if (e.key === "Escape") closePrompter();
    else if (e.key === " ") { e.preventDefault(); setPlaying(!P.running); }
  });

  // ---------- Nav counts, view switching ----------
  function updateNav() {
    $("navVideo").textContent = `${list("video").length} video đã lưu`;
    $("navArticle").textContent = `${list("article").length} bài đã lưu`;
    const n = list("speech").length;
    $("navSpeech").textContent = n ? `${n} bài · luyện mỗi ngày` : "Luyện nói trước đám đông";
  }
  document.addEventListener("se:view", (e) => {
    const v = e.detail;
    if (v !== "video") stopPlayer();
    if (!KINDS[v]) return;
    render(v);
    // Reopening a section with an item open resumes timing for it.
    const it = ui[v].open && getItem(v, ui[v].open);
    if (it) SE.startSession({ id: it.id, title: it.title }, v);
  });

  // Data arrived from the other device: update counts, and redraw a section's list (not an open item, to keep your place).
  document.addEventListener("se:synced", () => {
    updateNav();
    for (const k of Object.keys(KINDS)) if (!$("view-" + k).hidden && !ui[k].open) render(k);
  });

  // A key added or removed in Settings changes how the AI chat works: redraw the open section.
  $("settings").addEventListener("close", () => {
    for (const k of Object.keys(KINDS)) if (!$("view-" + k).hidden) render(k);
  });

  // ---------- Items sent by the browser extension ----------
  // The extension opens the app as …/LearningEnglish/#add=<items>; older versions posted a message instead.
  function receive(all) {
    const words = all.filter((x) => x?.kind === "word");
    const items = all.filter((x) => x && x.kind !== "word");
    words.forEach((w) => window.SE_WORDS?.save(w));
    (async () => {
      for (let i = 0; i < items.length; i++) await addItem(items[i], { open: i === items.length - 1, undo: true });
    })();
  }
  function takeFromAddress() {
    if (!location.hash.startsWith("#add=")) return;
    let payload = null;
    try { payload = JSON.parse(decodeURIComponent(location.hash.slice(5))); } catch { /* broken link: ignore */ }
    history.replaceState(null, "", location.pathname + location.search);
    if (Array.isArray(payload?.items)) receive(payload.items);
  }
  window.addEventListener("hashchange", takeFromAddress);
  // Wait until every script (the word list too) has loaded.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", takeFromAddress); else takeFromAddress();
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "se-ext" || !Array.isArray(e.data.items)) return;
    receive(e.data.items);
  });
  window.postMessage({ source: "se-app", type: "ready" }, location.origin);

  window.SE_LIB = { gemini, toast };
  updateNav();
})();
