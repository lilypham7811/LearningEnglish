// Voice handoff: continue practising by voice in ChatGPT, Gemini or Google AI Mode, with the learner's own
// account and app (phone or computer). The app writes the practice prompt (dialog, video, article, speech or
// today's words), copies it to the clipboard, and opens the chosen assistant with it filled in where possible:
//   ChatGPT        chatgpt.com/?q=…  fills in and sends the prompt (tested); then tap the voice button.
//   Gemini         gemini.google.com ignores ?q= (tested), so the prompt is pasted from the clipboard; then tap Live.
//   Google AI Mode google.com/search?udm=50&q=… fills it in (tested); speak with the mic.
// None of them can be opened straight into voice mode from a link, so the learner taps the voice button once.
(() => {
  "use strict";
  const SE = window.SE;
  const $ = (id) => document.getElementById(id);
  const esc = SE.esc;
  const URL_MAX = 6000; // longer prompts go only through the clipboard

  const TARGETS = {
    chatgpt: {
      name: "ChatGPT", icon: "💬",
      url: (p) => (encodeURIComponent(p).length <= URL_MAX ? `https://chatgpt.com/?q=${encodeURIComponent(p)}` : "https://chatgpt.com/"),
      filled: (p) => encodeURIComponent(p).length <= URL_MAX,
      steps: "ChatGPT mở ra và tự gửi bài. Chờ ChatGPT nói câu đầu, rồi chạm nút <b>giọng nói</b> (biểu tượng sóng âm cạnh ô chat) và bắt đầu nói.",
    },
    gemini: {
      name: "Gemini Live", icon: "✨",
      url: () => "https://gemini.google.com/app",
      filled: () => false,
      steps: "Gemini mở ra. Chạm vào ô chat → <b>Dán</b> (Ctrl+V, hoặc giữ ngón tay → Dán) → gửi. Sau đó chạm nút <b>Live</b> (sóng âm) để nói chuyện bằng giọng.",
    },
    aimode: {
      name: "Google AI Mode", icon: "🔎",
      url: (p) => `https://www.google.com/search?udm=50&q=${encodeURIComponent(p.length > 1800 ? p.slice(0, 1800) + "…" : p)}`,
      filled: (p) => p.length <= 1800,
      steps: "Google AI Mode mở ra với bài đã điền. Chạm biểu tượng <b>micro</b> để trả lời bằng giọng. Trên điện thoại, ứng dụng Google có chế độ nói chuyện trực tiếp (Live).",
    },
  };

  // ---------- Prompts (written for voice: one line at a time, short turns, corrections) ----------
  const VOICE_RULES =
    "We will continue in VOICE mode, so keep every turn short (one or two sentences), speak clearly and a little slowly, " +
    "and ask only one thing at a time. I am a Vietnamese learner of English. When I make a clear mistake, give a very short, kind correction " +
    "(\"You can say: …\"), let me try again, then continue. If I don't understand, explain briefly in Vietnamese, then go back to English.";

  function dialogPrompt(d, role, mode) {
    const me = d.speakers[role], ai = d.speakers[1 - role];
    const script = d.lines.map(([s, en]) => `${d.speakers[s]}: ${en}`).join("\n");
    if (mode === "free") {
      return `Let's practise speaking English about "${d.title}" (my level: ${d.level || "Intermediate"}). ${VOICE_RULES}\n` +
        `Have a natural conversation with me on this topic and help me reuse the useful phrases from this dialog:\n${script}\n\n` +
        `Start now with a short greeting and your first question.`;
    }
    return `Let's practise speaking English with a role-play (my level: ${d.level || "Intermediate"}). ${VOICE_RULES}\n` +
      `You are ${ai}. I am ${me}. Follow this dialog in order: say only YOUR next line, then wait for me to say mine. ` +
      `If I'm stuck, give me the first few words of my line. When we finish, tell me 2 things I did well and 2 things to improve, then offer to do it again without the script.\n\n` +
      `${script}\n\n` + (d.lines[0][0] === role ? `I speak first. Reply now only with: "Ready! You start."` : `Start now with your first line only.`);
  }
  function contentPrompt(kind, item) {
    const text = ((kind === "video" ? item.transcript : item.text) || "").replace(/\s+/g, " ").trim();
    const what = kind === "video" ? "news video" : kind === "article" ? "news article" : "speech";
    if (kind === "speech") {
      return `I have just practised giving this speech: "${item.title}". ${VOICE_RULES}\n` +
        `Be my audience and a public speaking coach: ask me realistic audience questions about it one at a time, listen to my answer, ` +
        `give one short tip to make it clearer or more confident, then ask the next question.\n\nSPEECH:\n${text.slice(0, 3000)}\n\nStart now: say "Great talk!" and ask your first question.`;
    }
    const phrases = (item.chat || []).filter((m) => m.type === "cards").flatMap((m) => m.items.map((p) => p.phrase)).slice(0, 8);
    return `I just ${kind === "video" ? "watched" : "read"} this ${what}: "${item.title}"${item.url ? ` (${item.url})` : ""}. ${VOICE_RULES}\n` +
      `Talk with me about it: ask about the main points and my opinion, one question at a time.` +
      (phrases.length ? ` Help me use these phrases from it: ${phrases.join("; ")}.` : "") +
      (text ? `\n\n${kind === "video" ? "TRANSCRIPT" : "ARTICLE"} (start):\n${text.slice(0, 2500)}` : "") +
      `\n\nStart now with a one-sentence summary and your first question.`;
  }
  function wordsPrompt(words) {
    const list = words.map((w) => `- ${w.word}${w.meaningVi ? ` (${w.meaningVi})` : ""}`).join("\n");
    return `Help me review my English vocabulary by voice. ${VOICE_RULES}\n` +
      `For each word below, one at a time: ask me what it means or give me a short situation, and ask me to say a sentence with it. ` +
      `Check my sentence (grammar and meaning), give the corrected version if needed, then go to the next word. At the end, tell me which words I should review again.\n\n` +
      `${list}\n\nStart now with the first word.`;
  }

  // ---------- Chooser ----------
  let current = null; // { title, prompt, inApp }
  function build() {
    if ($("handoffDlg")) return;
    const dlg = document.createElement("dialog");
    dlg.id = "handoffDlg";
    dlg.className = "sheet handoff";
    dlg.innerHTML = `<form method="dialog">
      <h3>🎙️ Luyện nói bằng giọng</h3>
      <p class="hint small" id="hoTitle"></p>
      <div class="ho-list">
        ${Object.entries(TARGETS).map(([k, t]) => `<button type="button" class="ho-btn" data-t="${k}"><span class="ho-ic">${t.icon}</span><span><b>${t.name}</b><small data-sub="${k}"></small></span></button>`).join("")}
        <button type="button" class="ho-btn" data-t="inapp"><span class="ho-ic">🎧</span><span><b>Ngay trong app</b><small>Google AI giọng nói, không rời app (cần khoá Google AI miễn phí)</small></span></button>
      </div>
      <div class="status" id="hoSteps" hidden></div>
      <details class="paste-more"><summary>Xem lời nhắn sẽ gửi</summary><textarea class="input" id="hoPrompt" rows="7" readonly></textarea></details>
      <div class="sheet-actions"><button class="btn" value="close">Đóng</button></div>
    </form>`;
    document.body.appendChild(dlg);
    dlg.querySelector(".ho-list").onclick = (e) => {
      const b = e.target.closest("[data-t]");
      if (b) go(b.dataset.t);
    };
  }
  function open(opts) {
    build();
    current = opts;
    $("hoTitle").textContent = opts.title ? `Bài: ${opts.title}. App chép sẵn lời nhắn và mở trợ lý bằng tài khoản của bạn trên máy này; bạn chỉ cần chạm nút giọng nói.` : "";
    $("hoPrompt").value = opts.prompt;
    $("hoSteps").hidden = true;
    for (const [k, t] of Object.entries(TARGETS)) {
      $("handoffDlg").querySelector(`[data-sub="${k}"]`).textContent = t.filled(opts.prompt) ? "Mở với bài đã điền sẵn" : "Mở rồi dán bài (đã chép sẵn)";
    }
    $("handoffDlg").querySelector('[data-t="inapp"]').hidden = !opts.inApp;
    $("handoffDlg").showModal();
  }
  // Must run inside the click (no await before window.open), or the browser blocks the new tab.
  function go(t) {
    if (t === "inapp") { $("handoffDlg").close(); current.inApp(); return; }
    const target = TARGETS[t];
    navigator.clipboard?.writeText(current.prompt).catch(() => {});
    window.open(target.url(current.prompt), "_blank", "noopener");
    SE.track("ai");
    SE.safeSet("handoffLast", t);
    $("hoSteps").hidden = false;
    $("hoSteps").innerHTML = `<b>${target.icon} ${target.name}:</b> ${target.steps}<br><span class="muted small">Lời nhắn đã được chép sẵn: nếu không thấy bài, dán vào ô chat.</span>`;
  }

  window.SE_HANDOFF = { open, dialogPrompt, contentPrompt, wordsPrompt };
})();
