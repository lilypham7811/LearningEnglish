(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const synth = window.speechSynthesis;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const IS_PHONE = matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 820;
  const LEVEL_VI = { Beginner: "Cơ bản", Intermediate: "Trung cấp", Advanced: "Nâng cao", General: "Chung" };

  const state = {
    dialog: null,        // { id, title, titleVi?, speakers, lines: [speaker, en, vi?][], level, source, topic? }
    voices: [],
    voiceA: null,
    voiceB: null,
    rate: 0.9,
    playToken: 0,        // bump to cancel a running playback sequence
    selected: -1,        // index of line being shadowed
    recording: null,     // shadow-panel recording session
    myAudioUrl: null,
    listening: null,     // active one-shot recognition (role-play)
    aiEngine: null,
    aiModelId: null,
    editing: false,
    rp: null,            // role-play session
  };

  // ---------- Voices ----------
  function loadVoices() {
    const all = synth.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
    if (!all.length) return;
    // Prefer natural/online voices (Edge, Safari), then Google voices (Chrome), then robotic desktop voices; US/GB first.
    const rank = (v) =>
      (/natural|online|neural|enhanced|premium/i.test(v.name) ? 0 : /google/i.test(v.name) ? 2 : 4) + (/en[-_](US|GB)/i.test(v.lang) ? 0 : 1);
    state.voices = all.sort((a, b) => rank(a) - rank(b));

    const saved = safeGet("voices") || {};
    const byName = (n) => state.voices.find((v) => v.name === n);
    state.voiceA = byName(saved.a) || state.voices[0];
    state.voiceB = byName(saved.b) || pickDifferentVoice(state.voiceA);

    for (const [sel, cur] of [[$("voiceA"), state.voiceA], [$("voiceB"), state.voiceB]]) {
      sel.innerHTML = state.voices
        .map((v) => `<option value="${esc(v.name)}">${esc(v.name)} (${v.lang})</option>`)
        .join("");
      sel.value = cur ? cur.name : "";
    }
  }
  // Try to pick a voice that sounds different (ideally the opposite gender).
  function pickDifferentVoice(a) {
    const female = /female|zira|aria|jenny|sonia|libby|samantha|susan|hazel|emma|ava|michelle|karen|natasha|moira|tessa|serena/i;
    const aFemale = a && female.test(a.name);
    return (
      state.voices.find((v) => v !== a && female.test(v.name) !== aFemale) ||
      state.voices.find((v) => v !== a) ||
      a
    );
  }
  function saveVoices() {
    state.voiceA = state.voices.find((v) => v.name === $("voiceA").value) || state.voiceA;
    state.voiceB = state.voices.find((v) => v.name === $("voiceB").value) || state.voiceB;
    safeSet("voices", { a: state.voiceA?.name, b: state.voiceB?.name });
  }

  // ---------- Speech ----------
  // Speak one text; resolves when finished. onWord(charIndex) for highlighting.
  // Natural AI voice (voice.js) when it is turned on and ready; otherwise the device's voice.
  function speak(text, voice, rate, onWord) {
    if (window.SE_VOICE?.enabled()) {
      const which = voice && voice === state.voiceB && state.voiceB !== state.voiceA ? "B" : "A";
      return window.SE_VOICE.speak(text, which, rate).then((ok) => (ok ? undefined : speakDevice(text, voice, rate, onWord)));
    }
    return speakDevice(text, voice, rate, onWord);
  }
  function speakDevice(text, voice, rate, onWord) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = "en-US";
      u.rate = rate;
      u.onboundary = (e) => { if (onWord && e.name !== "sentence") onWord(e.charIndex); };
      u.onend = u.onerror = () => resolve();
      synth.speak(u);
    });
  }
  function stopAll() {
    state.playToken++;
    synth.cancel();
    window.SE_VOICE?.stop();
    document.querySelectorAll(".line.active").forEach((el) => el.classList.remove("active"));
    clearWordHighlight();
  }
  const voiceFor = (i) => (state.dialog.lines[i][0] === 0 ? state.voiceA : state.voiceB);

  async function playLine(i, rate = state.rate, token = ++state.playToken) {
    synth.cancel();
    const li = $("dialog").children[i];
    document.querySelectorAll(".line.active").forEach((el) => el.classList.remove("active"));
    li?.classList.add("active");
    if (!state.rp) li?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const words = li ? [...li.querySelectorAll(".w")] : [];
    const next = state.dialog.lines[i + 1]; // get the next line ready while this one plays
    if (next) window.SE_VOICE?.prefetch(next[1], next[0] === 0 ? "A" : "B");
    await speak(state.dialog.lines[i][1], voiceFor(i), rate, (ci) => highlightWord(words, ci));
    if (token === state.playToken) { li?.classList.remove("active"); clearWordHighlight(); }
    return token === state.playToken; // false = cancelled
  }

  // Speak any text in the voice of line i's speaker (chunks, role-play). Resolves false if cancelled.
  async function say(text, i, rate = state.rate, token = ++state.playToken) {
    synth.cancel();
    await speak(text, voiceFor(i), rate);
    return token === state.playToken;
  }

  async function playAll() {
    track("listen");
    const token = ++state.playToken;
    for (let i = 0; i < state.dialog.lines.length; i++) {
      if (!(await playLine(i, state.rate, token))) return;
      await wait(350);
      if (token !== state.playToken) return;
    }
  }

  function highlightWord(words, charIndex) {
    clearWordHighlight();
    const w = words.find((el) => charIndex >= +el.dataset.s && charIndex < +el.dataset.e);
    w?.classList.add("on");
  }
  function clearWordHighlight() {
    document.querySelectorAll(".w.on").forEach((el) => el.classList.remove("on"));
  }

  // One-shot speech recognition for a single sentence.
  // Resolves { text, error, action }; state.listening.end(action) stops it early.
  function listenOnce(maxMs, target, onInterim) {
    return new Promise((resolve) => {
      const r = new Recognition();
      r.lang = "en-US";
      r.interimResults = true;
      r.continuous = false;
      r.maxAlternatives = 5;
      let text = "", error = null, done = false;
      const finish = (action = null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        state.listening = null;
        resolve({ text: text.trim(), error, action });
      };
      r.onresult = (e) => { text = bestTranscript(e.results, target); onInterim?.(text); };
      r.onerror = (e) => { error = e.error; };
      r.onend = () => finish();
      const timer = setTimeout(() => { try { r.stop(); } catch { finish(); } }, maxMs);
      state.listening = {
        end(action) {
          if (action) { try { r.abort(); } catch {} finish(action); }  // cancel/skip/model: drop what was heard
          else { try { r.stop(); } catch { finish(); } }               // "I'm done talking": keep it
        },
      };
      try { r.start(); } catch { error = "start-failed"; finish(); }
    });
  }

  // The recognizer "corrects" speech toward common phrases. It returns up to 5 guesses per segment;
  // keep the guess closest to the target sentence, so a correct sentence isn't marked wrong.
  function bestTranscript(results, target) {
    const want = new Set(tokenize(target).map(norm));
    const overlap = (s) => tokenize(s).map(norm).filter((w) => want.has(w)).length;
    return [...results].map((res) => {
      let best = res[0].transcript;
      for (let k = 1; k < res.length; k++) if (overlap(res[k].transcript) > overlap(best)) best = res[k].transcript;
      return best;
    }).join(" ").replace(/\s+/g, " ").trim();
  }

  // ---------- Dialog sources (no API) ----------
  const deaccent = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
  const HAS_VIETNAMESE = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

  // "I want to practice a conversation about space travel" -> "space travel"; "hội thoại về đi chợ" -> "đi chợ"
  function cleanTopic(topic) {
    return topic.trim().replace(/\s+/g, " ").replace(/[.?!]+$/, "")
      .replace(/^(i (want|would like|'d like) to )?(talk|chat|learn|practi[cs]e|speak)( about| on)? /i, "")
      .replace(/^(an? )?(conversation|dialog(ue)?|chat)( about| on)? /i, "")
      .replace(/^about /i, "")
      .replace(/^(luyện nói|hội thoại|nói chuyện|chủ đề|tiếng anh)( về| khi)? /i, "")
      .replace(/^(về|khi) /i, "") || topic.trim();
  }

  const STOPWORDS = new Set("a an the i im i'm me my we our you your to at in on of for and or with about is are was be want wanna would like go going get getting how what some new first".split(" "));
  const VI_FILLER = ["hoi thoai", "noi chuyen", "luyen noi", "luyen", "chu de", "tieng anh", "ve", "o", "tai", "khi", "cach", "voi", "ban", "minh", "toi", "muon", "di", "goi", "mua", "thue", "lam", "nhu the nao"];
  const keywordHit = (w, k) => w === k || (w.length > 3 && (k.startsWith(w) || w.startsWith(k)));
  const copyDialog = (d, source) => ({ ...d, lines: d.lines.map((l) => [...l]), source });

  // Returns the best library dialog, and whether it covers the whole topic
  // ("order food" / "gọi cà phê" -> exact; "space travel" -> partial, because "space" isn't covered).
  function matchLibrary(topic) {
    const words = tokenize(topic).filter((w) => !STOPWORDS.has(w));
    const vt = " " + deaccent(topic).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim() + " ";
    let best = null, bestScore = 0;
    for (const d of window.DIALOGS) {
      let score = 0;
      for (const w of words) for (const k of d.keywords) if (keywordHit(w, k)) score += w === k ? 3 : 1;
      for (const k of d.viKeywords || []) if (vt.includes(" " + k + " ")) score += 3 + k.split(" ").length;
      if (score > bestScore) { bestScore = score; best = d; }
    }
    if (!best || bestScore < 2) return { best: null, exact: false };
    const enExact = words.every((w) => best.keywords.some((k) => keywordHit(w, k)));
    // Vietnamese: exact when every syllable belongs to one of the dialog's keywords or a filler word.
    const syl = vt.trim().split(" ");
    const covered = syl.map(() => false);
    for (const k of [...(best.viKeywords || []), ...VI_FILLER]) {
      const ks = k.split(" ");
      for (let i = 0; i + ks.length <= syl.length; i++)
        if (ks.every((x, j) => syl[i + j] === x)) ks.forEach((_, j) => { covered[i + j] = true; });
    }
    return { best: copyDialog(best, "Thư viện có sẵn"), exact: enExact || covered.every(Boolean) };
  }

  // Last resort when AI isn't available: fill a template with the topic.
  function templateDialog(topic) {
    const t = window.FALLBACK_TEMPLATES[Math.floor(Math.random() * window.FALLBACK_TEMPLATES.length)];
    const clean = cleanTopic(topic);
    const lower = clean.toLowerCase();
    const title = clean.replace(/\b\w/g, (c) => c.toUpperCase());
    return {
      title: t.title.replace("{Topic}", title),
      speakers: t.speakers,
      lines: t.lines.map(([s, txt]) => [s, txt.replaceAll("{topic}", lower)]),
      level: "General",
      source: "Mẫu đơn giản (thiết bị này chưa chạy được AI)",
    };
  }

  // Runs a free open LLM fully in the browser via WebLLM + WebGPU. No API key, no server, no cost.
  const AI_MODELS = {
    fast:   { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama 3.2 1B", size: "~900 MB" },
    better: { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 3B", size: "~2.3 GB" },
  };
  const LEVELS = {
    Beginner:     { cefr: "A1-A2", maxWords: 12, style: "Use only very common, simple words and short sentences. Mostly present tense. No idioms or slang." },
    Intermediate: { cefr: "B1-B2", maxWords: 18, style: "Use natural everyday English with some common phrasal verbs and useful expressions." },
    Advanced:     { cefr: "C1",    maxWords: 28, style: "Use rich, natural English with idioms, phrasal verbs and varied grammar, the way native speakers really talk." },
  };
  const NAMES = ["Mia", "Leo", "Emma", "Jack", "Sofia", "Daniel", "Anna", "Tom", "Lily", "Ben", "Grace", "Ryan", "Chloe", "Max", "Olivia", "Sam", "Kate", "Noah", "Zoe", "Lucas"];
  const BAD_WORDS = /\b(fuck|shit|bitch|bastard|asshole|dick|pussy|slut|whore|nigg|retard)\w*/i;
  const MAX_ATTEMPTS = 3;
  const currentModel = () => AI_MODELS[$("aiModel").value] || AI_MODELS.fast;

  async function loadEngine(model) {
    if (state.aiEngine && state.aiModelId === model.id) return state.aiEngine;
    const status = $("aiStatus");
    status.textContent = `Đang khởi động AI miễn phí trên máy (${model.label})… Lần đầu sẽ tải mô hình một lần (${model.size}), các lần sau mở từ bộ nhớ trình duyệt.`;
    const webllm = await import("https://esm.run/@mlc-ai/web-llm");
    if (state.aiEngine) { await state.aiEngine.unload(); state.aiEngine = null; }
    state.aiEngine = await webllm.CreateMLCEngine(model.id, {
      initProgressCallback: (p) => {
        const pct = Math.round((p.progress || 0) * 100);
        status.textContent = `Đang tải AI: ${pct}% (${p.text})`;
      },
    });
    state.aiModelId = model.id;
    return state.aiEngine;
  }

  function buildPrompt(topic, level, a, b) {
    const L = LEVELS[level];
    return [
      { role: "system", content:
        `You are an experienced English teacher who writes realistic everyday conversations for ${level} (CEFR ${L.cefr}) learners from Vietnam. ${L.style} ` +
        `Every sentence must be grammatically correct, natural, and something a real person would actually say. ` +
        `Stay on the topic. No narration, no stage directions, no emojis, no translations, no explanations.` },
      { role: "user", content:
        `Write a conversation between ${a} and ${b} about: "${topic}".\n` +
        `(The topic may be written in Vietnamese. The conversation must be in English only.)\n` +
        `Rules:\n` +
        `- 10 to 14 lines. ${a} and ${b} take turns.\n` +
        `- Each line has at most ${L.maxWords} words.\n` +
        `- Open naturally, stay on the topic, and end the conversation naturally.\n` +
        `- Include useful phrases a learner can reuse in daily life.\n` +
        `Output only the conversation, one line per turn, in this format:\n${a}: ...\n${b}: ...` },
    ];
  }

  // Automatic checks. Returns a list of problems (empty = passed).
  function checkQuality({ lines }, level) {
    const L = LEVELS[level];
    const p = [];
    if (lines.length < 8) p.push("quá ngắn");
    if (lines.length > 18) p.push("quá dài");
    const counts = [0, 0];
    lines.forEach(([s]) => counts[s]++);
    if (Math.min(...counts) < 3) p.push("một người gần như không nói");
    for (let i = 2; i < lines.length; i++)
      if (lines[i][0] === lines[i - 1][0] && lines[i][0] === lines[i - 2][0]) { p.push("hai người không thay phiên nhau"); break; }
    const seen = new Set();
    if (lines.some(([, t]) => { const k = norm(t.replace(/\s/g, "")); return seen.has(k) || !seen.add(k); })) p.push("có câu bị lặp");
    // Same 3-word phrase in 3+ lines ("that way we", "that's a good idea") = lazy, repetitive writing.
    const phraseLines = new Map();
    lines.forEach(([, t]) => {
      const w = tokenize(t);
      new Set(w.slice(2).map((_, i) => w.slice(i, i + 3).join(" "))).forEach((ph) => phraseLines.set(ph, (phraseLines.get(ph) || 0) + 1));
    });
    const repeated = [...phraseLines].filter(([, n]) => n >= 3).map(([ph]) => `"${ph}"`);
    if (repeated.length) p.push("lặp cụm từ " + repeated.slice(0, 2).join(", "));
    if (lines.filter(([, t]) => t.split(/\s+/).length > L.maxWords * 1.3).length > 2) p.push("câu quá dài so với trình độ");
    if (lines.some(([, t]) => /[^\x00-\x7F‘’“”—–…éè]/.test(t))) p.push("có chữ không phải tiếng Anh");
    if (lines.some(([, t]) => BAD_WORDS.test(t))) p.push("từ ngữ không phù hợp");
    if (lines.some(([, t]) => /\b(as an ai|language model|here is (a|the) conversation)\b/i.test(t))) p.push("có lời thừa của AI");
    return p;
  }

  async function aiDialog(topic) {
    if (!navigator.gpu) throw new Error("trình duyệt chưa hỗ trợ WebGPU.");
    const status = $("aiStatus");
    status.hidden = false;
    const model = currentModel();
    const level = $("level").value;
    const engine = await loadEngine(model);
    topic = cleanTopic(topic);

    // Generate, check, and retry; keep the attempt with the fewest problems.
    let best = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      status.textContent = attempt === 1
        ? `AI đang viết bài ${LEVEL_VI[level].toLowerCase()} về "${topic}"…`
        : `Lần ${attempt}/${MAX_ATTEMPTS}: bài trước chưa đạt (${best.problems.join(", ")}), đang viết lại…`;
      const names = [...NAMES].sort(() => Math.random() - 0.5);
      const reply = await engine.chat.completions.create({
        temperature: attempt === 1 ? 0.7 : 0.9,
        max_tokens: 800,
        frequency_penalty: 0.6, // discourage repeating the same words/phrases
        presence_penalty: 0.4,
        messages: buildPrompt(topic, level, names[0], names[1]),
      });
      const parsed = parseAiDialog(reply.choices[0].message.content);
      const problems = checkQuality(parsed, level);
      if (!best || problems.length < best.problems.length) best = { ...parsed, problems };
      if (!problems.length) break;
    }
    if (best.lines.length < 4) throw new Error("không đọc được câu trả lời của AI. Hãy thử lại.");

    status.textContent = best.problems.length
      ? `⚠ Bài tốt nhất sau ${MAX_ATTEMPTS} lần vẫn còn lỗi: ${best.problems.join(", ")}. Bấm ✏️ Sửa để chỉnh, hoặc 🔄 Bài khác.`
      : "✓ Bài đã qua kiểm tra chất lượng. Cùng chủ đề sẽ ra bài khác mỗi lần.";
    const title = HAS_VIETNAMESE.test(topic) ? topic : topic.replace(/\b\w/g, (c) => c.toUpperCase());
    return { title, topic, speakers: best.speakers, lines: best.lines, level, source: `AI trên máy (${model.label})` };
  }

  // ---------- Google AI Mode (free, no key): open google.com in AI Mode with the question filled in ----------
  // Must be called directly from a click (no await before it), or the browser blocks the new tab.
  const AI_MODE_MAX = 1800; // keep the URL short enough; the full prompt is also copied to the clipboard
  function openAiMode(prompt) {
    const q = prompt.length > AI_MODE_MAX ? prompt.slice(0, AI_MODE_MAX) + "…" : prompt;
    navigator.clipboard?.writeText(prompt).catch(() => {});
    window.open(`https://www.google.com/search?udm=50&q=${encodeURIComponent(q)}`, "_blank", "noopener");
    return prompt.length > AI_MODE_MAX;
  }

  // ---------- Google AI (Gemini, free tier with the learner's own key) ----------
  const geminiKey = () => (safeGet("geminiKey") || "").trim();
  const GEMINI_TEXT_MODEL = "gemini-3.8-flash";

  const writeDialog = (topic) => (geminiKey() ? geminiDialog(topic) : aiDialog(topic));

  async function geminiDialog(topic) {
    const status = $("aiStatus");
    status.hidden = false;
    const level = $("level").value;
    topic = cleanTopic(topic);
    status.textContent = `Google AI đang viết bài ${LEVEL_VI[level].toLowerCase()} về "${topic}"…`;
    const L = LEVELS[level];
    const prompt =
      `Write a realistic everyday English conversation for a ${level} (CEFR ${L.cefr}) learner from Vietnam about: "${topic}". ` +
      `(The topic may be written in Vietnamese; the conversation must be in English.) ${L.style} ` +
      `10 to 14 lines, two speakers (names or roles) taking turns, each line at most ${L.maxWords} words. ` +
      `Every line must be natural and something a real person would say. Open naturally, stay on topic, end naturally, ` +
      `and include useful phrases the learner can reuse. Give a natural Vietnamese translation for every line, ` +
      `a short English title, a Vietnamese title, and one fitting emoji.`;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey() },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING" }, titleVi: { type: "STRING" }, emoji: { type: "STRING" },
              speakers: { type: "ARRAY", items: { type: "STRING" } },
              lines: { type: "ARRAY", items: { type: "OBJECT", properties: {
                speaker: { type: "INTEGER", description: "0 or 1, index into speakers" },
                en: { type: "STRING" }, vi: { type: "STRING" },
              }, required: ["speaker", "en", "vi"] } },
            },
            required: ["title", "titleVi", "emoji", "speakers", "lines"],
          },
        },
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(geminiError(res.status, json));
    const out = JSON.parse(json.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "{}");
    const lines = (out.lines || []).filter((l) => l.en).map((l) => [l.speaker === 1 ? 1 : 0, l.en.trim(), (l.vi || "").trim()]);
    if (lines.length < 4) throw new Error("câu trả lời không đúng dạng. Hãy thử lại.");
    status.textContent = "✓ Google AI đã viết xong. Bài đã tự lưu vào “⭐ Của tôi”.";
    return {
      title: out.title || topic, titleVi: out.titleVi || "", emoji: out.emoji || "💬", topic,
      speakers: (out.speakers || []).slice(0, 2).concat(["A", "B"]).slice(0, 2),
      lines, level, source: "Google AI",
    };
  }
  function geminiError(status, json) {
    const msg = json?.error?.message || "";
    if (status === 400 && /api key/i.test(msg)) return "khoá Google AI không đúng. Hãy kiểm tra lại trong Cài đặt.";
    if (status === 403) return "khoá Google AI không có quyền dùng. Hãy tạo khoá mới ở aistudio.google.com/apikey.";
    if (status === 429) return "đã dùng hết lượt miễn phí trong lúc này. Hãy đợi một lát rồi thử lại.";
    return `lỗi ${status}${msg ? ": " + msg : ""}`;
  }

  function parseAiDialog(text) {
    const speakers = [];
    const lines = [];
    for (const raw of text.split("\n")) {
      const m = raw.match(/^\s*[*_]*([A-Z][\w .'-]{0,20}?)[*_]*\s*:\s*[*_]*(.+?)[*_]*\s*$/);
      if (!m) continue;
      let name = m[1].trim();
      // The model sometimes copies the format placeholder ("Name:", "Person A:") literally.
      if (/^(name|speaker|person)\b|^[AB12]$/i.test(name)) name = "~" + name;
      let idx = speakers.indexOf(name);
      if (idx === -1) {
        if (speakers.length === 2) continue;
        speakers.push(name);
        idx = speakers.length - 1;
      }
      const line = m[2]
        .replace(/\([^)]*\)|\[[^\]]*\]|\*[^*]+\*/g, "")   // (laughs) [smiles] *waves*
        .replace(/\p{Extended_Pictographic}/gu, "")        // emojis
        .replace(/^["“]|["”]$/g, "").replace(/\s+/g, " ").trim();
      if (line) lines.push([idx, line]);
    }
    if (speakers.length < 2) speakers.push("Friend");
    const spare = ["Sam", "Mia", "Leo", "Nina"].filter((n) => !speakers.includes(n));
    for (let i = 0; i < speakers.length; i++) if (speakers[i].startsWith("~")) speakers[i] = spare.shift();
    return { speakers, lines };
  }

  // ---------- Pasted dialogs (written in Claude / ChatGPT, free) ----------
  function pastePrompt() {
    const topic = cleanTopic($("topicInput").value) || "a common everyday situation";
    const level = $("level").value;
    const L = LEVELS[level];
    return `You are an experienced English teacher. Write a realistic everyday English conversation for a ${level} (CEFR ${L.cefr}) learner from Vietnam about: "${topic}".
${L.style}
Rules:
- 10 to 14 lines, two speakers with names or roles, taking turns.
- Each line has at most ${L.maxWords} words, sounds natural, and is something a real person would say.
- Include useful phrases the learner can reuse in daily life.
- After each English line, add " | " and a natural Vietnamese translation.
Output ONLY this format, with no other text:
# English title | Vietnamese title
Name1: English sentence | Vietnamese translation
Name2: English sentence | Vietnamese translation`;
  }

  function parsePasted(text) {
    let title = "", titleVi = "";
    const speakers = [], lines = [];
    for (let raw of text.split("\n")) {
      raw = raw.replace(/\*\*|__|`/g, "").trim();
      if (!raw || /^```/.test(raw)) continue;
      const h = raw.match(/^#+\s*(.+)$/);
      if (h) { [title, titleVi = ""] = h[1].split("|").map((s) => s.trim()); continue; }
      const m = raw.match(/^([^:|]{1,25}):\s*(.+)$/);
      if (!m) continue;
      const name = m[1].trim();
      let idx = speakers.indexOf(name);
      if (idx === -1) {
        if (speakers.length === 2) continue;
        idx = speakers.push(name) - 1;
      }
      const [en, vi] = m[2].split(/\s+\|\s+|\s+\/\/\s+/).map((s) => s.replace(/^["“]|["”]$/g, "").trim());
      if (en) lines.push(vi ? [idx, en, vi] : [idx, en]);
    }
    if (lines.length < 2 || speakers.length < 2) return null;
    const topic = cleanTopic($("topicInput").value);
    return { title: title || topic || "My Conversation", titleVi, topic, speakers, lines, level: $("level").value, source: "Dán từ AI" };
  }

  // ---------- Saved dialogs (kept in this browser's localStorage) ----------
  const getSaved = () => safeGet("saved") || [];
  const isSaved = (id) => getSaved().some((d) => d.id === id);

  function toggleSave() {
    const d = state.dialog;
    let saved = getSaved();
    if (isSaved(d.id)) {
      saved = saved.filter((x) => x.id !== d.id);
    } else {
      const { id, title, titleVi, speakers, lines, level, source, topic } = d;
      saved.unshift({ id, title, titleVi, speakers, lines, level, source, topic, savedAt: Date.now() });
    }
    if (!safeSet("saved", saved)) alert("Không lưu được. Có thể trình duyệt đang chặn bộ nhớ (chế độ ẩn danh?).");
    updateSaveBtn();
    renderSaved();
  }
  function updateSaveBtn() {
    const on = state.dialog && isSaved(state.dialog.id);
    $("saveBtn").textContent = on ? "★ Đã lưu" : "☆ Lưu";
    $("saveBtn").classList.toggle("saved", on);
  }
  // AI-written and pasted dialogs are kept automatically, so they show up in the topic row.
  function autoSave(d) {
    if (isSaved(d.id)) return;
    const { id, title, titleVi, speakers, lines, level, source, topic } = d;
    safeSet("saved", [{ id, title, titleVi, speakers, lines, level, source, topic, savedAt: Date.now() }, ...getSaved()]);
  }
  function renderSaved() {
    const n = getSaved().length;
    $("savedCount").textContent = n;
    renderTopics();
  }

  // ---------- Dialog list: one table of every dialog (library + mine) ----------
  // Columns: topic | dialog (click to practise) | date created. Search, filters, sortable columns;
  // on phones each row becomes a card.
  const CATEGORY_COLORS = {
    "Ăn uống": "var(--r1)", "Mua sắm": "var(--r2)", "Du lịch & đi lại": "var(--r5)", "Sức khỏe": "var(--r4)",
    "Công việc & học tập": "var(--r6)", "Dịch vụ": "var(--turmeric)", "Giao tiếp hằng ngày": "var(--leaf)",
    "Giải trí & sở thích": "var(--r7)", "Chủ đề khác": "var(--ink-3)",
  };
  const catColor = (c) => CATEGORY_COLORS[c] || "var(--ink-3)";
  const LEVEL_SHORT = { Beginner: "A2", Intermediate: "B1", Advanced: "C1" };
  let topicFilter = "all";
  const tableUi = { q: "", sort: "topic", dir: 1 };

  // My dialogs (AI-written or pasted) get the topic of the closest library dialog.
  function categoryOf(d) {
    if (d.category) return d.category;
    const lib = window.DIALOGS.find((x) => x.id === d.id);
    if (lib) return lib.category;
    const { best } = matchLibrary(cleanTopic(d.topic || d.title || ""));
    return best?.category || "Chủ đề khác";
  }
  const createdAt = (d) => d.savedAt || (d.added ? new Date(d.added + "T00:00:00").getTime() : 0);
  function topicList() {
    const mine = getSaved().map((d) => ({ ...d, mine: true }));
    const lib = window.DIALOGS.filter((d) => !mine.some((m) => m.id === d.id));
    let all = [...mine, ...lib].map((d) => ({ ...d, cat: categoryOf(d), at: createdAt(d) }));
    if (topicFilter === "saved") all = all.filter((d) => d.mine);
    else if (topicFilter !== "all") all = all.filter((d) => d.level === topicFilter);
    const q = deaccent(tableUi.q.trim());
    if (q) all = all.filter((d) => deaccent(`${d.cat} ${d.title} ${d.titleVi || ""}`).includes(q));
    const key = { topic: (d) => deaccent(d.cat) + " " + deaccent(d.titleVi || d.title), title: (d) => deaccent(d.titleVi || d.title), date: (d) => d.at };
    const k = key[tableUi.sort];
    return all.sort((a, b) => (k(a) > k(b) ? 1 : k(a) < k(b) ? -1 : 0) * tableUi.dir);
  }
  function renderTopics() {
    const list = topicList();
    const arrow = (col) => (tableUi.sort === col ? (tableUi.dir > 0 ? " ▲" : " ▼") : "");
    const th = (col, label, cls = "") => `<th class="${cls}"><button type="button" class="th-sort" data-sort="${col}" aria-sort="${tableUi.sort === col ? (tableUi.dir > 0 ? "ascending" : "descending") : "none"}">${label}<span class="sort-ic">${arrow(col)}</span></button></th>`;
    $("dlgTable").innerHTML = `<thead><tr>${th("topic", "Chủ đề", "c-topic")}${th("title", "Đoạn hội thoại", "c-title")}${th("date", "Ngày tạo", "c-date")}</tr></thead><tbody>` +
      (list.length ? list.map((d) => `<tr data-id="${esc(d.id)}" class="${state.dialog?.id === d.id ? "on" : ""}" tabindex="0">
        <td class="c-topic" data-label="Chủ đề"><span class="cat" style="--cc:${catColor(d.cat)}"><i></i>${esc(d.cat)}</span></td>
        <td class="c-title" data-label="Đoạn hội thoại"><div class="dt-main">
            <span class="dt-emoji">${d.emoji || "💬"}</span>
            <span class="dt-names"><b>${esc(d.titleVi || d.title)}</b>${d.titleVi ? `<small>${esc(d.title)}</small>` : ""}</span>
            <span class="dt-tags"><span class="lvl lvl-${(d.level || "").toLowerCase()}" title="${LEVEL_VI[d.level] || ""}">${LEVEL_SHORT[d.level] || "–"}</span>${d.mine ? `<span class="chip ai">★ Của tôi</span>` : ""}</span>
            <span class="dt-go">Luyện <span aria-hidden="true">→</span></span></div></td>
        <td class="c-date" data-label="Ngày tạo">${d.at ? new Date(d.at).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }) : "–"}</td>
      </tr>`).join("") : `<tr><td colspan="3" class="empty-row">${topicFilter === "saved" ? "Chưa có bài nào của bạn. Bài tạo bằng AI hoặc dán vào sẽ tự lưu ở đây; bài có sẵn thì bấm ☆ Lưu." : "Không tìm thấy bài nào."}</td></tr>`) +
      "</tbody>";
    $("dlgCount").textContent = `${list.length} bài`;
  }
  function onTopicClick(e) {
    const s = e.target.closest("button[data-sort]");
    if (s) {
      tableUi.dir = tableUi.sort === s.dataset.sort ? -tableUi.dir : s.dataset.sort === "date" ? -1 : 1; // newest first on first click
      tableUi.sort = s.dataset.sort;
      return renderTopics();
    }
    const row = e.target.closest("tr[data-id]");
    if (!row) return;
    const mine = getSaved().find((x) => x.id === row.dataset.id);
    const src = mine || window.DIALOGS.find((x) => x.id === row.dataset.id);
    if (!src) return;
    const d = copyDialog(src, mine ? mine.source : "Thư viện có sẵn");
    d.color = catColor(categoryOf(src));
    render(d);
  }

  // Backup of everything (my dialogs, videos, articles, speeches, practice log, settings except the Google key)
  // as one .json file. Merging works like sync (sync.js), so importing twice never duplicates anything.
  function exportSaved() {
    const data = window.SE_SYNC.collect(false);
    const blob = new Blob([JSON.stringify({ app: "shadow-english", version: 3, exportedAt: new Date().toISOString(), data })], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `shadow-english-sao-luu-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function importSaved(file) {
    try {
      const json = JSON.parse(await file.text());
      // Version 1 backups were just the array of saved dialogs.
      const data = Array.isArray(json) ? { saved: json } : json?.app === "shadow-english" ? json.data : null;
      if (!data) throw 0;
      const { added } = window.SE_SYNC.merge(data);
      window.SE_SYNC.dirty();
      alert(`Đã nhập ${added} mục. App sẽ tải lại.`);
      location.reload();
    } catch {
      alert("File này không phải file sao lưu của Shadow English.");
    }
  }

  // ---------- Fixing a dialog: regenerate or edit by hand ----------
  async function regenerate() {
    const d = state.dialog;
    $("topicInput").value = d.topic || d.title;
    $("regenBtn").disabled = true;
    try {
      const nd = await writeDialog(d.topic || d.title);
      autoSave(nd);
      renderSaved();
      render(nd);
    } catch (err) {
      $("aiStatus").hidden = false;
      $("aiStatus").textContent = "AI không viết được bài: " + err.message;
    } finally {
      $("regenBtn").disabled = false;
    }
  }

  function toggleEdit() {
    if (!state.editing) {
      stopAll();
      closeShadow();
      state.editing = true;
      document.body.classList.add("editing");
      $("editBtn").textContent = "✓ Xong";
      document.querySelectorAll("#dialog .text").forEach((el) => {
        el.textContent = el.textContent; // drop word spans while editing
        el.contentEditable = "plaintext-only";
      });
      document.querySelector("#dialog .text")?.focus();
      return;
    }
    const texts = [...document.querySelectorAll("#dialog .text")].map((el) => el.textContent.replace(/\s+/g, " ").trim());
    const d = state.dialog;
    // A changed sentence loses its old translation.
    d.lines = d.lines.map(([s, t, vi], i) => (texts[i] && texts[i] !== t ? [s, texts[i]] : vi ? [s, t, vi] : [s, t]));
    if (!/đã sửa/.test(d.source)) d.source += " · đã sửa";
    if (isSaved(d.id)) {
      safeSet("saved", getSaved().map((x) => (x.id === d.id ? { ...x, lines: d.lines, source: d.source } : x)));
      renderSaved();
    }
    render(d);
  }

  // ---------- Rendering ----------
  const gtLink = (text) => `https://translate.google.com/?sl=en&tl=vi&op=translate&text=${encodeURIComponent(text)}`;

  function render(d) {
    stopAll();
    closeShadow();
    closeRoleplay();
    if (!d.id) d.id = "u" + Date.now(); // AI/template dialogs get an id so they can be saved
    state.dialog = d;
    showView("talk");
    startSession(d, "talk");
    state.editing = false;
    document.body.classList.remove("editing");
    $("editBtn").textContent = "✏️ Sửa";
    $("regenBtn").hidden = !geminiKey() && !navigator.gpu;
    $("emptyDialog").hidden = true;
    $("dialogSection").hidden = false;
    $("dialogSection").style.setProperty("--gc", d.color || "var(--leaf)");
    renderTopics();
    $("dialogTitle").textContent = d.title;
    $("dialogTitleVi").textContent = d.titleVi || "";
    $("dialogMeta").textContent = `${LEVEL_VI[d.level] || d.level} · ${d.speakers.join(" & ")} · ${d.source}`;
    const hasVi = d.lines.some((l) => l[2]);
    $("showViWrap").hidden = !hasVi;
    $("translateAll").hidden = hasVi;
    $("translateAll").href = gtLink(d.lines.map((l) => l[1]).join("\n"));
    updateSaveBtn();

    const ol = $("dialog");
    ol.innerHTML = "";
    d.lines.forEach(([s, text, vi], i) => {
      const li = document.createElement("li");
      li.className = "line " + (s === 0 ? "a" : "b");
      li.innerHTML = `
        <button class="play" aria-label="Nghe">🔊</button>
        <div class="bubble">
          <div class="speaker">${esc(d.speakers[s])}</div>
          <div class="text">${wrapWords(text)}</div>
          ${vi ? `<div class="vi">${esc(vi)}</div>` : ""}
        </div>`;
      li.querySelector(".play").onclick = () => { track("listen"); playLine(i); };
      li.querySelector(".bubble").onclick = () => { if (!state.editing) openShadow(i); };
      ol.appendChild(li);
    });
    $("dialogSection").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  // Wrap each word in a span carrying its char offsets, for boundary highlighting.
  function wrapWords(text) {
    let out = "", last = 0;
    for (const m of text.matchAll(/\S+/g)) {
      out += esc(text.slice(last, m.index));
      out += `<span class="w" data-s="${m.index}" data-e="${m.index + m[0].length}">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }

  // ---------- Shadowing ----------
  const note = (t) => { $("shadowNote").textContent = t; };

  function openShadow(i) {
    stopAll();
    stopRecording(true);
    if (state.selected < 0) track("shadow");
    state.selected = i;
    document.querySelectorAll(".line.selected").forEach((el) => el.classList.remove("selected"));
    const li = $("dialog").children[i];
    li.classList.add("selected");
    const [s, text, vi] = state.dialog.lines[i];
    $("shadowWho").textContent = state.dialog.speakers[s];
    $("shadowPos").textContent = `Câu ${i + 1}/${state.dialog.lines.length}`;
    $("shadowText").textContent = text;
    $("shadowVi").innerHTML = vi
      ? esc(vi)
      : `<a href="${gtLink(text)}" target="_blank" rel="noopener">🌐 Xem nghĩa (Google Dịch)</a>`;
    $("result").hidden = true;
    $("chunks").hidden = true;
    $("prevLine").disabled = i === 0;
    $("nextLine").disabled = i === state.dialog.lines.length - 1;
    note(Recognition
      ? "Cách luyện: 🔊 Nghe → 🧩 Từng cụm → 🔁 Nhại ×3 → 🎙️ Ghi âm để chấm điểm."
      : "Trình duyệt này không chấm điểm phát âm được (hãy dùng Chrome), nhưng bạn vẫn ghi âm và so sánh được.");
    $("shadow").hidden = false;
    document.body.classList.add("shadow-open");
    setTimeout(() => li.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
  }
  function closeShadow() {
    stopRecording(true);
    $("shadow").hidden = true;
    document.body.classList.remove("shadow-open");
    document.querySelectorAll(".line.selected").forEach((el) => el.classList.remove("selected"));
    state.selected = -1;
  }

  // Play the line, then stay silent for about as long as the line took so the learner can repeat it.
  async function shadowLoop(times = 3) {
    const token = ++state.playToken;
    for (let n = 0; n < times; n++) {
      note(`Lần ${n + 1}/${times}: nghe…`);
      const t0 = performance.now();
      if (!(await playLine(state.selected, state.rate, token))) return;
      const dur = performance.now() - t0;
      note(`Lần ${n + 1}/${times}: giờ bạn nói theo!`);
      await wait(Math.max(1500, dur * 1.3));
      if (token !== state.playToken) return;
    }
    note("Tốt lắm! Bấm 🎙️ Ghi âm để chấm điểm phát âm.");
  }

  // Split a sentence into natural thought groups: at punctuation, then long parts before a
  // joining word or a determiner (so "their requirements" or "a week" stay together).
  const JOIN = /^(and|but|or|so|because|if|when|to|for|with|at|in|on|of|that|which|who|from|before|after|while|than|about|a|an|the|my|your|his|her|our|their|this|these|those|some)$/i;
  function splitChunks(text) {
    const parts = (text.match(/[^,.;:!?]+[,.;:!?]*/g) || [text]).map((s) => s.trim()).filter(Boolean);
    const splitLong = (p) => {
      const w = p.split(/\s+/);
      if (w.length <= 5) return [p];
      let cut = -1, bestDist = Infinity;
      for (let i = 2; i <= w.length - 2; i++) {
        if (!JOIN.test(w[i].replace(/[^a-z']/gi, ""))) continue;
        const dist = Math.abs(i - w.length / 2);
        if (dist < bestDist) { bestDist = dist; cut = i; }
      }
      if (cut < 0) {
        if (w.length <= 7) return [p];
        cut = Math.ceil(w.length / 2);
      }
      return [...splitLong(w.slice(0, cut).join(" ")), ...splitLong(w.slice(cut).join(" "))];
    };
    return parts.flatMap(splitLong);
  }

  // Back-chaining: practise the END of the sentence first, then add one chunk at a time to the front.
  // The learner always finishes with the natural sentence-final intonation, and never repeats more than they can hold.
  async function chunkPractice() {
    const i = state.selected;
    const text = state.dialog.lines[i][1];
    // Build up one sentence at a time, so a step is never longer than one sentence (until the final run).
    const sentences = (text.match(/[^.!?]+[.!?]*/g) || [text]).map((x) => x.trim()).filter(Boolean);
    const steps = [];
    for (const sentence of sentences) {
      const chunks = splitChunks(sentence);
      for (let k = chunks.length - 1; k >= 0; k--) steps.push(chunks.slice(k).join(" "));
    }
    if (steps.length < 2) { note("Câu này đã ngắn rồi. Hãy dùng 🔁 Nhại ×3."); return; }
    track("chunk");
    steps.push(text); // the whole line at the end
    const ol = $("chunks");
    ol.innerHTML = steps.map((s) => `<li>${esc(s)}</li>`).join("");
    ol.hidden = false;
    $("result").hidden = true;
    const token = ++state.playToken;
    for (let n = 0; n < steps.length; n++) {
      [...ol.children].forEach((li, j) => { li.className = j < n ? "done" : j === n ? "now" : ""; });
      note(`Bước ${n + 1}/${steps.length}: nghe…`);
      const t0 = performance.now();
      if (!(await say(steps[n], i, state.rate, token))) return;
      note(`Bước ${n + 1}/${steps.length}: giờ bạn nói theo!`);
      await wait(Math.max(1200, (performance.now() - t0) * 1.4));
      if (token !== state.playToken) return;
    }
    [...ol.children].forEach((li) => { li.className = "done"; });
    note("Tuyệt! Giờ bấm 🎙️ Ghi âm để nói cả câu và chấm điểm.");
  }

  async function toggleRecording() {
    if (state.recording) return stopRecording();
    stopAll();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      note("Không dùng được micro. Hãy cho phép micro trong trình duyệt rồi thử lại.");
      return;
    }
    const rec = { chunks: [], stream, transcript: "", retried: false, noAudio: false };
    rec.recorder = new MediaRecorder(stream);
    rec.recorder.ondataavailable = (e) => e.data.size && rec.chunks.push(e.data);
    rec.recorder.onstop = () => {
      if (state.myAudioUrl) URL.revokeObjectURL(state.myAudioUrl);
      state.myAudioUrl = rec.noAudio || !rec.chunks.length
        ? null
        : URL.createObjectURL(new Blob(rec.chunks, { type: rec.recorder.mimeType }));
      stream.getTracks().forEach((t) => t.stop());
    };
    rec.recorder.start();
    state.recording = rec;
    if (Recognition) startRecognition(rec);
    $("recordBtn").classList.add("on");
    $("recordBtn").textContent = "⏹ Dừng";
    note("Đang ghi âm… hãy nói câu này. Nói xong bấm Dừng.");
  }

  function startRecognition(rec) {
    const r = new Recognition();
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = true;
    r.maxAlternatives = 5;
    r.onresult = (e) => {
      rec.transcript = bestTranscript(e.results, state.dialog.lines[state.selected][1]);
      note("Đang nghe: " + rec.transcript);
    };
    r.onerror = (e) => {
      if (e.error === "audio-capture" && !rec.retried) {
        // Some phones can't record and recognise at the same time: keep the scoring, drop the recording.
        rec.retried = true;
        rec.noAudio = true;
        rec.recognition = null;
        if (rec.recorder.state !== "inactive") rec.recorder.stop();
        setTimeout(() => { if (state.recording === rec) startRecognition(rec); }, 250);
      } else if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        note("Trình duyệt chặn nhận dạng giọng nói. Bạn vẫn có thể nghe lại bản ghi âm.");
      } else if (e.error === "network") {
        note("Chấm điểm cần kết nối Internet.");
      }
    };
    r.onend = () => { if (state.recording === rec && rec.recognition === r) stopRecording(); };
    rec.recognition = r;
    try { r.start(); } catch {}
  }

  function stopRecording(silent = false) {
    const rec = state.recording;
    if (!rec) return;
    state.recording = null;
    $("recordBtn").classList.remove("on");
    $("recordBtn").textContent = "🎙️ Ghi âm & chấm điểm";
    try { rec.recognition?.stop(); } catch {}
    if (rec.recorder.state !== "inactive") rec.recorder.stop();
    if (silent) return;
    // Give recognition a moment to deliver its final result.
    setTimeout(() => showResult(rec.transcript), Recognition ? 400 : 0);
  }

  function showResult(transcript) {
    $("result").hidden = false;
    $("chunks").hidden = true;
    setTimeout(() => { $("playMine").disabled = !state.myAudioUrl; }, 100);
    const target = state.dialog.lines[state.selected][1];
    if (!Recognition) {
      $("scoreNum").textContent = "–";
      $("diff").textContent = target;
      $("heard").textContent = "(trình duyệt này không hỗ trợ chấm điểm)";
      $("tips").innerHTML = "";
      return;
    }
    const { html, score, missed } = compareWords(target, transcript);
    track("record", transcript ? score : undefined);
    $("scoreNum").textContent = score;
    $("diff").innerHTML = html;
    $("heard").textContent = transcript || "(không nghe thấy gì, hãy nói to hơn một chút)";
    $("tips").innerHTML = transcript ? pronunciationTips(missed).map((t) => `<li>${t}</li>`).join("") : "";
    note(
      score >= 90 ? "Xuất sắc! 🎉 Chuyển sang câu tiếp theo nhé." :
      score >= 70 ? "Tốt lắm! Nghe lại và chú ý các từ màu đỏ." :
      "Cố lên! Thử 🐢 Chậm và 🧩 Từng cụm, rồi ghi âm lại."
    );
  }

  // Tips for the pronunciation problems Vietnamese speakers most often have.
  function pronunciationTips(missed) {
    const tips = new Set();
    for (const raw of missed) {
      const w = raw.toLowerCase().replace(/[^a-z']/g, "");
      if (/^th/.test(w)) tips.add("<b>Âm “th”</b> (<i>think, the</i>): đặt đầu lưỡi giữa hai hàm răng rồi đẩy hơi ra. Đừng đọc thành “t”, “d” hay “s”.");
      if (/ed$/.test(w) && w.length > 3) tips.add("<b>Đuôi -ed</b>: đọc /t/, /d/ hoặc /ɪd/ (<i>worked, played, wanted</i>). Đừng bỏ âm này.");
      else if (/([^s']s|es|'s)$/.test(w) && w.length > 2) tips.add("<b>Âm cuối /s/ /z/</b> (<i>books, it's, she likes</i>): người Việt hay bỏ âm này. Hãy đọc rõ tiếng “xì” ở cuối.");
      else if (/[tkpdgbfvzlm]$/.test(w) || /(ch|sh|ge|ve|ce|se|ke|te|pe)$/.test(w)) tips.add("<b>Đừng nuốt âm cuối</b>: tiếng Anh phải đọc rõ phụ âm cuối (<i>like, that, stop, food</i>). “Like” khác “lie”!");
      if (tips.size >= 2) break;
    }
    return [...tips].slice(0, 2);
  }

  // ---------- Role-play ----------
  const HINT_NAMES = ["Vòng 1: cả câu", "Vòng 2: chữ cái đầu", "Vòng 3: chỉ nghĩa tiếng Việt"];
  const rpStatus = (t) => { $("rpStatus").textContent = t; };
  const firstLetters = (text) => text.replace(/[A-Za-z]+(?:'[A-Za-z]+)?/g, (w) => w[0] + w.slice(1).replace(/[A-Za-z]/g, "_"));

  function openRoleplay() {
    if (state.editing) toggleEdit();
    stopAll();
    closeShadow();
    const d = state.dialog;
    state.rp = { role: state.rp?.role ?? 1, hint: 0, token: 0, scores: [], resolve: null };
    renderRoles();
    document.querySelector('input[name="rpHint"][value="0"]').checked = true;
    // Without Vietnamese translations, round 3 shows only the word count.
    document.querySelector('input[name="rpHint"][value="2"]').nextElementSibling.querySelector("small").textContent =
      d.lines.some((l) => l[2]) ? "Tự nói lại bằng tiếng Anh" : "Bài này chưa có nghĩa tiếng Việt: chỉ hiện số từ, bạn tự nhớ lại câu";
    $("rpRound").textContent = "";
    showRpView("setup");
    $("rp").hidden = false;
    document.body.classList.add("rp-open");
  }
  function renderRoles() {
    const d = state.dialog;
    $("rpRoles").innerHTML = d.speakers.map((n, s) => {
      const count = d.lines.filter((l) => l[0] === s).length;
      return `<button data-s="${s}" class="${s === state.rp.role ? "on" : ""}">${esc(n)}<small>${count} câu</small></button>`;
    }).join("");
  }
  // Scroll only the role-play's own area (scrollIntoView would also scroll the page behind it).
  function rpScrollEnd() {
    const body = $("rp").querySelector(".rp-body");
    body.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
  }
  function showRpView(v) {
    $("rpSetup").hidden = v !== "setup";
    $("rpChat").hidden = v === "setup";
    $("rpBar").hidden = v !== "chat";
    $("rpEnd").hidden = v !== "end";
  }
  function closeRoleplay() {
    const rp = state.rp;
    if (!rp) return;
    rp.token++;
    state.listening?.end("cancel");
    if (rp.resolve) { const r = rp.resolve; rp.resolve = null; r("cancel"); }
    stopAll();
    $("rp").hidden = true;
    document.body.classList.remove("rp-open");
    state.rp = null;
  }
  // Wait for the learner to press a role-play button: "retry" | "model" | "skip" | "cancel".
  const rpWaitAction = () => new Promise((res) => { state.rp.resolve = res; });
  function rpButton(action) {
    const rp = state.rp;
    if (!rp) return;
    if (state.listening) { state.listening.end(action === "retry" ? null : action); return; }
    if (rp.resolve) { const r = rp.resolve; rp.resolve = null; r(action); }
  }

  function rpBubble(i, mine) {
    const d = state.dialog;
    const [s, text, vi] = d.lines[i];
    const viHtml = vi ? `<div class="vi">${esc(vi)}</div>` : "";
    let body;
    if (!mine || state.rp.hint === 0) body = `<div class="text">${esc(text)}</div>${viHtml}`;
    else if (state.rp.hint === 1) body = `<div class="text hint-letters">${esc(firstLetters(text))}</div>${viHtml}`;
    else body = vi
      ? `<div class="text cue">🇻🇳 ${esc(vi)}</div>`
      : `<div class="text cue">(Hãy nhớ lại câu này: ${text.split(/\s+/).length} từ)</div>`;
    const li = document.createElement("li");
    li.className = "line " + (mine ? "b mine" : "a");
    li.innerHTML = `<div class="bubble"><div class="speaker">${esc(d.speakers[s])}${mine ? " (bạn)" : ""}</div>${body}</div>`;
    $("rpChat").appendChild(li);
    rpScrollEnd();
    return li;
  }
  // Show the real sentence (coloured by match) in the learner's bubble.
  function rpReveal(li, i, result) {
    const [s, text, vi] = state.dialog.lines[i];
    const badge = result
      ? `<span class="badge ${result.score >= 80 ? "good" : result.score >= 60 ? "ok" : "low"}">${result.score}%</span>`
      : "";
    li.querySelector(".bubble").innerHTML = `<div class="speaker">${esc(state.dialog.speakers[s])} (bạn)</div>
      <div class="text">${result ? result.html : esc(text)}</div>${vi ? `<div class="vi">${esc(vi)}</div>` : ""}${badge}`;
    li.classList.add("done");
  }

  async function rpRun() {
    const rp = state.rp, d = state.dialog;
    const token = ++rp.token;
    track("roleplay");
    rp.scores = [];
    $("rpChat").innerHTML = "";
    $("rpRound").textContent = `· Bạn là ${d.speakers[rp.role]} · ${HINT_NAMES[rp.hint]}`;
    showRpView("chat");
    for (let i = 0; i < d.lines.length; i++) {
      if (token !== rp.token) return;
      const mine = d.lines[i][0] === rp.role;
      const li = rpBubble(i, mine);
      if (!mine) {
        rpStatus(`${d.speakers[d.lines[i][0]]} đang nói…`);
        await say(d.lines[i][1], i);
        if (token !== rp.token) return;
        await wait(250);
      } else {
        await rpUserTurn(i, li, token);
      }
    }
    if (token === rp.token) rpFinish();
  }

  async function rpUserTurn(i, li, token) {
    const rp = state.rp;
    const text = state.dialog.lines[i][1];
    let best = 0, tried = false;
    // "model" plays the sentence and goes round again; other actions are returned as-is.
    const handle = async (action) => {
      if (action === "model") { rpStatus("🔊 Câu mẫu…"); await say(text, i, Math.max(0.6, state.rate - 0.1)); return "again"; }
      return action;
    };
    const skip = () => { if (!tried) rpReveal(li, i, null); rp.scores.push(best); };
    while (true) {
      if (token !== rp.token) return;
      if (!Recognition) {
        rpStatus("Hãy nói câu của bạn, rồi bấm ⏭ Tiếp. (Trình duyệt này không chấm điểm được.)");
        const a = await handle(await rpWaitAction());
        if (a === "cancel") return;
        if (a === "skip") { rpReveal(li, i, null); return; }
        continue;
      }
      rpStatus(tried ? "🎙️ Nói lại nào!" : "🎙️ Đến lượt bạn, hãy nói!");
      $("rpMic").classList.add("on");
      const res = await listenOnce(15000, text, (t) => rpStatus("🎙️ " + t));
      $("rpMic").classList.remove("on");
      if (token !== rp.token) return;
      if (res.action) {
        const a = await handle(res.action);
        if (a === "cancel") return;
        if (a === "skip") return skip();
        continue;
      }
      if (!res.text) {
        rpStatus(res.error === "not-allowed" || res.error === "service-not-allowed"
          ? "Micro bị chặn. Hãy cho phép micro trong trình duyệt, rồi bấm 🎙️."
          : res.error === "network"
            ? "Chấm điểm cần Internet. Kiểm tra mạng rồi bấm 🎙️ để nói lại."
            : "Chưa nghe thấy gì. Bấm 🎙️ để nói lại, 🔊 để nghe mẫu, hoặc ⏭ để bỏ qua.");
        const a = await handle(await rpWaitAction());
        if (a === "cancel") return;
        if (a === "skip") return skip();
        continue;
      }
      tried = true;
      const result = compareWords(text, res.text);
      best = Math.max(best, result.score);
      rpReveal(li, i, result);
      if (result.score >= 60) {
        rpStatus(result.score >= 90 ? "Xuất sắc! 🎉" : "Tốt lắm! 👍");
        rp.scores.push(best);
        await wait(900);
        return;
      }
      rpStatus(`${result.score}%: thử lại nhé! 🎙️ nói lại · 🔊 nghe mẫu · ⏭ đi tiếp`);
      const a = await handle(await rpWaitAction());
      if (a === "cancel") return;
      if (a === "skip") return skip();
    }
  }

  function rpFinish() {
    const rp = state.rp;
    const avg = rp.scores.length ? Math.round(rp.scores.reduce((a, b) => a + b, 0) / rp.scores.length) : 0;
    $("rpScore").textContent = Recognition ? avg : "✓";
    if (Recognition && rp.scores.length) trackScore(avg);
    const last = rp.hint >= 2;
    $("rpEndMsg").textContent = !Recognition
      ? "Hoàn thành vòng này!"
      : avg >= 85 ? (last ? "Tuyệt vời! Bạn đã nói được cả bài mà không cần nhìn chữ. 🏆" : "Rất tốt! Sẵn sàng cho vòng khó hơn.")
      : avg >= 60 ? "Khá lắm! Chơi lại một lần nữa sẽ tốt hơn nhiều."
      : "Cố lên! Hãy luyện từng câu bằng 🧩 Từng cụm, rồi quay lại nhập vai.";
    $("rpNext").hidden = last;
    showRpView("end");
    rpScrollEnd();
  }

  // ---------- Scoring ----------
  // Word-level match using the longest common subsequence.
  function compareWords(target, spoken) {
    const display = target.split(/\s+/);
    const t = display.map(norm);
    const s = tokenize(spoken).map(norm);
    const dp = Array.from({ length: t.length + 1 }, () => new Array(s.length + 1).fill(0));
    for (let i = t.length - 1; i >= 0; i--)
      for (let j = s.length - 1; j >= 0; j--)
        dp[i][j] = t[i] === s[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const hit = new Array(t.length).fill(false);
    for (let i = 0, j = 0; i < t.length && j < s.length; ) {
      if (t[i] === s[j]) { hit[i] = true; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    const html = display.map((w, i) => `<span class="${hit[i] ? "hit" : "miss"}">${esc(w)}</span>`).join(" ");
    const score = t.length ? Math.round((hit.filter(Boolean).length / t.length) * 100) : 0;
    return { html, score, missed: display.filter((_, i) => !hit[i]) };
  }
  const ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
  const TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
  function numToWords(n) {
    if (n < 20) return ONES[n];
    if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ONES[n % 10] : "");
    if (n < 1000) return ONES[Math.floor(n / 100)] + "hundred" + (n % 100 ? numToWords(n % 100) : "");
    return String(n);
  }
  function norm(w) {
    w = w.toLowerCase().replace(/[^a-z0-9]/g, ""); // "Don't" -> "dont", "twenty-two" -> "twentytwo"
    return /^\d+$/.test(w) ? numToWords(+w) : w;
  }
  const tokenize = (s) => (s || "").toLowerCase().split(/[\s,.;:!?"()\/-]+/).filter(Boolean);

  // ---------- Helpers ----------
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function safeGet(k) { try { return JSON.parse(localStorage.getItem("se_" + k)); } catch { return null; } }
  // Synced lists: every changed item gets updatedAt, every removed item a tombstone, so computer and phone
  // can merge their copies (newest version of each item wins, deletions spread). sync.js does the merging.
  const SYNC_LISTS = ["saved", "videos", "articles", "speeches", "words", "log"];
  const SYNC_PREFS = ["level", "aiModel", "alwaysAi", "showVi", "voices", "geminiVoice", "geminiKey"];
  function safeSet(k, v) {
    try {
      if (SYNC_LISTS.includes(k) && Array.isArray(v)) v = stampList(k, v);
      localStorage.setItem("se_" + k, JSON.stringify(v));
      if (SYNC_LISTS.includes(k) || SYNC_PREFS.includes(k)) window.SE_SYNC?.dirty(k);
      return true;
    } catch { return false; }
  }
  // Write without stamping (used by sync.js when it applies data from the other device).
  function rawSet(k, v) { try { localStorage.setItem("se_" + k, JSON.stringify(v)); return true; } catch { return false; } }
  function stampList(k, next) {
    const strip = (x) => JSON.stringify({ ...x, updatedAt: 0 });
    const before = new Map((safeGet(k) || []).filter((x) => x?.id).map((x) => [x.id, strip(x)]));
    const now = Date.now();
    const ids = new Set();
    const out = next.map((x) => {
      if (!x?.id) return x;
      ids.add(x.id);
      return before.get(x.id) === strip(x) ? x : { ...x, updatedAt: now };
    });
    const removed = [...before.keys()].filter((id) => !ids.has(id));
    if (removed.length) {
      const tomb = safeGet("tomb") || {};
      removed.forEach((id) => { tomb[id] = now; });
      rawSet("tomb", tomb);
    }
    return out;
  }

  function updateAiNote() {
    $("aiNote").hidden = true; // tip line removed at the learner's request
    return;
    const m = currentModel();
    if (geminiKey()) {
      $("aiNote").textContent = "✨ Chủ đề có sẵn mở ngay. Chủ đề mới do Google AI viết trong vài giây, kèm nghĩa tiếng Việt, và tự lưu vào “⭐ Của tôi”.";
      return;
    }
    $("aiNote").innerHTML = `Mẹo: chủ đề mới → bấm <button type="button" class="linkish" data-open-paste>📋 Dán hội thoại</button> → <b>Hỏi Google AI Mode</b> (miễn phí, không cần đăng ký). ` +
      `Hoặc dán khoá Google AI trong <button type="button" class="linkish" data-open-settings>Cài đặt</button> để AI viết bài ngay trong app. `;
    $("aiNote").querySelector("[data-open-settings]").onclick = openSettings;
    $("aiNote").querySelector("[data-open-paste]").onclick = () => $("pasteBtn").click();
    $("aiNote").append(navigator.gpu
      ? `Chưa có khoá thì AI chạy trên máy sẽ viết bài (chậm hơn, lần đầu tải ${m.size}${IS_PHONE ? ", nên dùng Wi-Fi" : ""}).`
      : "Chưa có khoá thì hãy chọn một chủ đề có sẵn bên dưới.");
  }

  // ---------- Views & settings ----------
  function showView(v) {
    if ($("view-" + v).hidden) {
      window.scrollTo({ top: 0 });
      endSession(); // time on another section is not practice on the last item
    }
    document.querySelectorAll("main > .view").forEach((el) => { el.hidden = el.id !== "view-" + v; });
    document.querySelectorAll(".nav button[data-view]").forEach((b) => b.removeAttribute("aria-current"));
    document.querySelector(`.nav button[data-view="${v}"]`)?.setAttribute("aria-current", "page");
    if (v !== "talk") { stopAll(); closeShadow(); }
    if (v === "progress") renderProgress();
    document.dispatchEvent(new CustomEvent("se:view", { detail: v }));
  }
  function openSettings() {
    $("geminiKey").value = geminiKey();
    window.SE_VOICE?.refreshSettings();
    $("settings").showModal();
  }
  function updateAiState() {
    const on = !!geminiKey();
    $("aiState").dataset.mode = on ? "cloud" : "local";
    $("aiState").querySelector("span").textContent = on ? "Google AI: đã có khoá" : "Google AI: chưa có khoá";
    if (state.dialog) $("regenBtn").hidden = !on && !navigator.gpu;
    updateAiNote();
  }

  // ---------- Practice tracking (Section 2) ----------
  // One session per opened dialog. Time only counts while the learner is actually practising:
  // page visible, a dialog open, and some activity in the last 90 s (or audio / role-play / Google AI running).
  const LOG_MAX = 3000;
  let session = null, lastActive = 0, progressRange = 7;
  const getLog = () => safeGet("log") || [];

  // kind: talk | video | article | speech (which section the practice happened in)
  function startSession(d, kind = "talk") {
    saveSession();
    session = { id: "s" + Date.now(), start: Date.now(), end: Date.now(), dialogId: d.id, title: d.title, titleVi: d.titleVi || "",
      kind, seconds: 0, acts: {}, best: null };
    lastActive = Date.now();
  }
  function endSession() {
    saveSession();
    session = null;
  }
  function track(kind, score) {
    if (!session) return;
    lastActive = Date.now();
    session.acts[kind] = (session.acts[kind] || 0) + 1;
    if (typeof score === "number") session.best = Math.max(session.best ?? 0, score);
    saveSession();
  }
  function trackScore(score) {
    if (!session || typeof score !== "number") return;
    session.best = Math.max(session.best ?? 0, score);
    saveSession();
  }
  function saveSession() {
    if (!session || (session.seconds < 10 && !Object.keys(session.acts).length)) return;
    session.end = Date.now();
    const log = getLog().filter((x) => x.id !== session.id);
    log.push({ ...session });
    safeSet("log", log.slice(-LOG_MAX));
    updateNavProgress();
  }
  function initTracking() {
    const mark = () => { lastActive = Date.now(); };
    ["pointerdown", "keydown"].forEach((ev) => document.addEventListener(ev, mark, true));
    let tick = 0;
    setInterval(() => {
      if (!session || document.visibilityState !== "visible") return;
      const busy = synth?.speaking || state.recording || state.rp || window.SE_LIVE?.active || window.SE_BUSY;
      if (!busy && Date.now() - lastActive > 90000) return;
      // A long break starts a new session for the same dialog.
      if (Date.now() - session.end > 30 * 60000 && session.seconds > 0)
        startSession({ id: session.dialogId, title: session.title, titleVi: session.titleVi }, session.kind);
      session.seconds++;
      session.end = Date.now();
      if (++tick % 15 === 0) saveSession();
    }, 1000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveSession(); });
    window.addEventListener("pagehide", saveSession);
    updateNavProgress();
  }

  const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const fmtDur = (s) => s < 60 ? `${s} giây` : s < 3600 ? `${Math.round(s / 60)} phút` : `${Math.floor(s / 3600)} giờ ${Math.round((s % 3600) / 60)} phút`;
  const ACT_NAMES = { listen: "Nghe", shadow: "Nhại câu", record: "Ghi âm", chunk: "Từng cụm", roleplay: "Nhập vai", ai: "Nói với Google AI",
    open: "Mở link", read: "Đọc", chat: "Hỏi Google AI", phrase: "Luyện cụm từ", prompter: "Đọc chạy chữ", speech: "Ghi âm bài nói", feedback: "AI nhận xét", word: "Lưu từ", review: "Ôn từ" };
  const KIND_NAMES = { talk: "Hội thoại", video: "Video", article: "Bài báo", speech: "Phát biểu", words: "Sổ từ vựng" };

  function updateNavProgress() {
    const today = dayKey(Date.now());
    const s = getLog().filter((x) => dayKey(x.start) === today).reduce((a, x) => a + x.seconds, 0);
    $("navProgress").textContent = s ? `Hôm nay: ${fmtDur(s)}` : "Hôm nay chưa luyện";
  }
  function streakDays(days) {
    let n = 0;
    const d = new Date();
    if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1); // today not done yet: count up to yesterday
    while (days.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  function renderProgress() {
    saveSession();
    const all = getLog();
    const since = progressRange ? Date.now() - progressRange * 86400000 : 0;
    const log = all.filter((x) => x.start >= since);
    const secs = log.reduce((a, x) => a + x.seconds, 0);
    const days = new Set(log.map((x) => dayKey(x.start)));
    const allDays = new Set(all.map((x) => dayKey(x.start)));
    const scores = log.map((x) => x.best).filter((x) => x != null);
    const rangeTxt = progressRange ? `${progressRange} ngày qua` : "từ trước đến nay";
    const kpi = (label, val, unit, color, foot) =>
      `<div class="kpi" style="--pc:${color}"><div class="k-label">${label}</div><div class="k-val">${val}<small> ${unit}</small></div><div class="k-foot">${foot}</div></div>`;
    $("kpis").innerHTML =
      kpi("Tổng thời gian", secs >= 3600 ? (secs / 3600).toFixed(1) : Math.round(secs / 60), secs >= 3600 ? "giờ" : "phút", "var(--r4)", rangeTxt) +
      kpi("Số lần luyện", log.length, "lần", "var(--r5)", `${rangeTxt}`) +
      kpi("Số ngày đã luyện", days.size, "ngày", "var(--r2)", progressRange ? `trên ${progressRange} ngày` : "tổng cộng") +
      kpi("Chuỗi ngày liên tiếp", streakDays(allDays), "ngày", "var(--r1)", "luyện mỗi ngày để giữ chuỗi") +
      kpi("Điểm phát âm TB", scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : "–", scores.length ? "%" : "", "var(--r7)", "điểm cao nhất mỗi lần");

    // Heatmap: 12 weeks (columns) × 7 days (rows, Monday first), shaded by minutes practised.
    const perDay = {};
    all.forEach((x) => { const k = dayKey(x.start); perDay[k] = (perDay[k] || 0) + x.seconds; });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) - 7 * 11);
    const DAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
    let html = `<span></span>`;
    for (let w = 0; w < 12; w++) {
      const d = new Date(monday); d.setDate(monday.getDate() + w * 7);
      html += `<span class="ml">${d.getDate() <= 7 || w === 0 ? "Th" + (d.getMonth() + 1) : ""}</span>`;
    }
    for (let r = 0; r < 7; r++) {
      html += `<span class="dl">${r % 2 === 0 ? DAYS[r] : ""}</span>`;
      for (let w = 0; w < 12; w++) {
        const d = new Date(monday); d.setDate(monday.getDate() + w * 7 + r);
        const k = dayKey(d), s = perDay[k] || 0;
        const lvl = !s ? 0 : s < 300 ? 1 : s < 900 ? 2 : s < 1800 ? 3 : 4;
        const cls = d > today ? "c future" : k === dayKey(today) ? "c today" : "c";
        html += `<span class="${cls}" data-l="${lvl}" title="${d.toLocaleDateString("vi-VN")}: ${s ? fmtDur(s) : "chưa luyện"}"></span>`;
      }
    }
    html += `<div class="heat-legend">Ít <span class="c" data-l="0"></span><span class="c" data-l="1"></span><span class="c" data-l="2"></span><span class="c" data-l="3"></span><span class="c" data-l="4"></span> Nhiều</div>`;
    $("heat").innerHTML = html;

    // Top topics by time.
    const byTopic = {};
    log.forEach((x) => { const t = byTopic[x.dialogId] ||= { name: x.titleVi || x.title, s: 0, n: 0 }; t.s += x.seconds; t.n++; });
    const top = Object.values(byTopic).sort((a, b) => b.s - a.s).slice(0, 7);
    const max = top[0]?.s || 1;
    const pillColor = (i) => `var(--r${[5, 4, 2, 7, 1, 6, 3][i % 7]})`;
    $("topTopics").innerHTML = top.length
      ? top.map((t, i) => `<div class="lg" style="--pc:${pillColor(i)}"><span class="lg-name">${esc(t.name)}</span><span class="lg-bar"><i style="width:${Math.max(4, (t.s / max) * 100)}%"></i></span><span class="lg-n">${fmtDur(t.s)}</span></div>`).join("")
      : `<p class="hint">Chưa có dữ liệu. Mở một chủ đề và bắt đầu luyện nhé!</p>`;

    // Log table, newest first.
    const rows = [...log].reverse().slice(0, 200);
    $("logTable").innerHTML = rows.length
      ? `<thead><tr><th>Ngày</th><th>Giờ</th><th>Chủ đề</th><th>Đã luyện</th><th class="num">Thời gian</th><th class="num">Điểm</th></tr></thead><tbody>` +
        rows.map((x) => {
          const d = new Date(x.start);
          const acts = Object.entries(x.acts).map(([k, n]) => `<span class="chip${k === "ai" ? " ai" : ""}">${ACT_NAMES[k] || k}${n > 1 ? " ×" + n : ""}</span>`).join("");
          return `<tr><td>${d.toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}</td>
            <td class="muted">${d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</td>
            <td><span class="chip kind-${x.kind || "talk"}">${KIND_NAMES[x.kind || "talk"]}</span> <b>${esc(x.titleVi || x.title)}</b>${x.titleVi ? `<span class="muted small"> · ${esc(x.title)}</span>` : ""}</td>
            <td>${acts || '<span class="muted">Đọc bài</span>'}</td>
            <td class="num">${fmtDur(x.seconds)}</td>
            <td class="num">${x.best != null ? x.best + "%" : "–"}</td></tr>`;
        }).join("") + "</tbody>"
      : `<tbody><tr><td class="muted">Chưa có buổi luyện nào ${progressRange ? "trong " + progressRange + " ngày qua" : ""}.</td></tr></tbody>`;
  }

  // Shared with live.js (Google AI live practice).
  window.SE = {
    get dialog() { return state.dialog; },
    geminiKey, openAiMode, track, trackScore, startSession, endSession, stopAll, closeShadow, openSettings, showView, safeGet, safeSet, esc, LEVELS,
    rawSet, saveSession, SYNC_LISTS, SYNC_PREFS,
    // Redraw everything after sync brought in data from the other device.
    refreshAll: () => {
      renderSaved();
      updateNavProgress();
      updateAiState();
      $("geminiKey").value = geminiKey();
      if (!$("view-progress").hidden) renderProgress();
    },
    levelName: (lv) => LEVEL_VI[lv] || lv,
    // Speech helpers for sections 3-5.
    say: (text, rate = state.rate) => { stopAll(); state.playToken++; return speak(text, state.voiceA, rate); },
    listenOnce: (maxMs, target, onInterim) => listenOnce(maxMs, target, onInterim),
    stopListening: () => state.listening?.end(),
    compareWords, pronunciationTips, hasRecognition: !!Recognition,
    geminiError,
  };

  // ---------- Wire up ----------
  async function onSubmit(e) {
    e?.preventDefault();
    const topic = $("topicInput").value.trim();
    if (!topic) return $("topicInput").focus();
    $("topicInput").blur(); // close the phone keyboard
    const btn = $("topicForm").querySelector("button");
    const { best, exact } = matchLibrary(cleanTopic(topic));
    $("aiStatus").hidden = true;

    // 1. Common topic we already have a hand-written dialog for: instant.
    if (best && exact && !$("aiMode").checked) return render(best);

    // 2. Anything else: Google AI if there is a key, otherwise the free on-device AI.
    if (geminiKey() || navigator.gpu) {
      btn.disabled = true;
      btn.textContent = "Đang viết…";
      try {
        const d = await writeDialog(topic);
        autoSave(d);
        renderSaved();
        return render(d);
      } catch (err) {
        $("aiStatus").hidden = false;
        $("aiStatus").textContent = "AI không viết được bài: " + err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = "Tạo";
      }
    } else {
      $("aiStatus").hidden = false;
      $("aiStatus").textContent = "Thiết bị này chưa chạy được AI (cần Chrome hoặc Edge mới).";
    }

    // 3. Fallback: closest library dialog, or a template (English topics only: a Vietnamese topic inside English sentences makes no sense).
    if (best) return render(best);
    if (HAS_VIETNAMESE.test(topic)) {
      $("aiStatus").textContent += " Chưa có bài cho chủ đề này. Hãy chọn một chủ đề có sẵn bên dưới.";
      return;
    }
    render(templateDialog(topic));
  }

  function init() {
    if (!synth) {
      document.body.insertAdjacentHTML("afterbegin", `<p style="background:#fee;color:#900;padding:10px;text-align:center;margin:0">Trình duyệt này không đọc được tiếng Anh. Hãy dùng Chrome, Edge hoặc Safari.</p>`);
    } else {
      loadVoices();
      synth.onvoiceschanged = loadVoices;
    }

    $("dlgTable").onclick = onTopicClick;
    $("topicFilter").onclick = (e) => {
      const b = e.target.closest("button[data-f]");
      if (!b) return;
      topicFilter = b.dataset.f;
      $("topicFilter").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      renderTopics();
    };
    $("dlgSearch").oninput = (e) => { tableUi.q = e.target.value; renderTopics(); };
    $("dlgTable").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("tr[data-id]")) onTopicClick(e); });
    $("navTalk").textContent = `${window.DIALOGS.length} chủ đề có sẵn`;
    document.querySelector(".nav").onclick = (e) => {
      const b = e.target.closest("button[data-view]");
      if (!b) return;
      if (b.dataset.view === "settings") return openSettings();
      showView(b.dataset.view);
    };
    $("rangeSeg").onclick = (e) => {
      const b = e.target.closest("button[data-r]");
      if (!b) return;
      progressRange = +b.dataset.r;
      $("rangeSeg").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      renderProgress();
    };
    $("clearLog").onclick = () => {
      if (!confirm("Xóa toàn bộ nhật ký luyện tập? Không thể khôi phục.")) return;
      safeSet("log", []);
      renderProgress();
    };
    initTracking();

    // Preferences
    $("aiModel").value = IS_PHONE ? "fast" : "better";
    for (const id of ["level", "aiModel"]) {
      const v = safeGet(id);
      if (v) $(id).value = v;
      $(id).onchange = () => { safeSet(id, $(id).value); updateAiNote(); };
    }
    $("aiMode").checked = !!safeGet("alwaysAi");
    $("aiMode").onchange = () => safeSet("alwaysAi", $("aiMode").checked);
    $("showVi").checked = !!safeGet("showVi");
    document.body.classList.toggle("show-vi", $("showVi").checked);
    $("showVi").onchange = (e) => { document.body.classList.toggle("show-vi", e.target.checked); safeSet("showVi", e.target.checked); };
    updateAiNote();

    $("topicForm").onsubmit = onSubmit;
    $("playAllBtn").onclick = playAll;
    $("stopBtn").onclick = stopAll;
    $("roleplayBtn").onclick = openRoleplay;
    $("saveBtn").onclick = toggleSave;
    $("regenBtn").onclick = regenerate;
    $("editBtn").onclick = toggleEdit;
    $("exportBtn").onclick = $("exportBtn2").onclick = exportSaved;
    $("importBtn").onclick = $("importBtn2").onclick = () => $("importFile").click();
    $("importFile").onchange = (e) => { if (e.target.files[0]) importSaved(e.target.files[0]); e.target.value = ""; };
    renderSaved();
    $("rate").oninput = (e) => { state.rate = +e.target.value; $("rateVal").textContent = state.rate.toFixed(2).replace(/0$/, "") + "×"; };
    $("hideText").onchange = (e) => document.body.classList.toggle("hide-text", e.target.checked);

    // Shadow panel
    $("listenBtn").onclick = () => { track("listen"); playLine(state.selected); };
    $("slowBtn").onclick = () => playLine(state.selected, Math.max(0.5, state.rate - 0.3));
    $("chunkBtn").onclick = chunkPractice;
    $("loopBtn").onclick = () => shadowLoop(3);
    $("recordBtn").onclick = toggleRecording;
    $("prevLine").onclick = () => openShadow(state.selected - 1);
    $("nextLine").onclick = () => openShadow(state.selected + 1);
    $("closeShadow").onclick = closeShadow;
    $("playMine").onclick = () => { if (state.myAudioUrl) { stopAll(); new Audio(state.myAudioUrl).play(); } };
    $("playOrig").onclick = () => playLine(state.selected);

    // Role-play
    $("rpClose").onclick = closeRoleplay;
    $("rpRoles").onclick = (e) => {
      const b = e.target.closest("button");
      if (b) { state.rp.role = +b.dataset.s; renderRoles(); }
    };
    $("rpStart").onclick = () => {
      state.rp.hint = +document.querySelector('input[name="rpHint"]:checked').value;
      rpRun();
    };
    $("rpMic").onclick = () => rpButton("retry");
    $("rpModel").onclick = () => rpButton("model");
    $("rpSkip").onclick = () => rpButton("skip");
    $("rpNext").onclick = () => { state.rp.hint = Math.min(2, state.rp.hint + 1); rpRun(); };
    $("rpAgain").onclick = () => rpRun();
    $("rpSwap").onclick = () => { state.rp.role = 1 - state.rp.role; state.rp.hint = 0; rpRun(); };

    $("geminiKey").value = geminiKey();
    $("geminiKey").onchange = () => { safeSet("geminiKey", $("geminiKey").value.trim()); updateAiState(); };
    $("geminiVoice").value = safeGet("geminiVoice") || "Kore";
    $("geminiVoice").onchange = () => safeSet("geminiVoice", $("geminiVoice").value);
    $("settings").addEventListener("close", () => { safeSet("geminiKey", $("geminiKey").value.trim()); updateAiState(); });
    updateAiState();
    $("pasteBtn").onclick = () => { $("pasteErr").textContent = ""; $("pasteDlg").showModal(); };
    $("copyPrompt").onclick = async () => {
      try {
        await navigator.clipboard.writeText(pastePrompt());
        $("copyPrompt").textContent = "✓ Đã chép!";
      } catch {
        $("pasteText").value = pastePrompt(); // clipboard blocked: show the prompt so it can be copied by hand
        $("pasteErr").textContent = "Không tự chép được. Hãy chép lời nhắn trong ô trên, rồi xóa ô và dán câu trả lời vào.";
      }
      setTimeout(() => { $("copyPrompt").textContent = "📄 Chép lời nhắn"; }, 4000);
    };
    $("aiModePaste").onclick = () => {
      openAiMode(pastePrompt());
      $("pasteErr").textContent = "Đã mở Google AI Mode trong tab mới. Khi có câu trả lời, chép toàn bộ đoạn hội thoại và dán vào ô trên.";
    };
    $("pasteOpen").onclick = () => {
      const d = parsePasted($("pasteText").value);
      if (!d) {
        $("pasteErr").textContent = "Chưa đọc được hội thoại. Mỗi dòng cần có dạng “Tên: câu tiếng Anh | nghĩa tiếng Việt”.";
        return;
      }
      $("pasteDlg").close();
      $("pasteText").value = "";
      d.id = "u" + Date.now();
      autoSave(d);
      renderSaved();
      render(d);
    };
    $("voiceA").onchange = $("voiceB").onchange = saveVoices;

    document.addEventListener("keydown", (e) => {
      if (state.rp || state.selected < 0 || e.target.matches("input, select, textarea, [contenteditable]")) return;
      if (e.key === "ArrowRight" && state.selected < state.dialog.lines.length - 1) openShadow(state.selected + 1);
      else if (e.key === "ArrowLeft" && state.selected > 0) openShadow(state.selected - 1);
      else if (e.key === " ") { e.preventDefault(); playLine(state.selected); }
      else if (e.key.toLowerCase() === "r") toggleRecording();
      else if (e.key === "Escape") closeShadow();
    });
  }

  init();
  // Installed app: works offline after the first visit (needs https or localhost).
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  // Stay up to date: an app installed on the phone is only resumed, never reloaded, when reopened.
  // Each time the app comes back to the screen (and every 30 min), ask the server for the current version
  // (the ?v= number of app.js) and reload when it is newer. The version is shown in the rail.
  const APP_VERSION = +((document.querySelector('script[src*="app.js"]')?.src.match(/[?&]v=(\d+)/) || [])[1] || 0);
  $("appVersion").textContent = "Phiên bản " + APP_VERSION;
  async function checkForUpdate() {
    if (state.recording || state.rp || window.SE_LIVE?.active || window.SE_BUSY) return; // don't interrupt practice
    try {
      const html = await (await fetch(location.pathname + "?check=" + Date.now(), { cache: "no-store" })).text();
      const latest = +((html.match(/app\.js\?v=(\d+)/) || [])[1] || 0);
      if (latest > APP_VERSION) {
        // Never loop: reload once for a given version. If the page is still old after that (a stale cache on
        // the phone), clear the app's caches once and reload; after that, stop and just show a button.
        const tried = sessionGet("se_updFor");
        if (tried === String(latest)) {
          if (sessionGet("se_updHard") === String(latest)) { showUpdateButton(latest); return; }
          sessionSet("se_updHard", latest);
          await clearAppCaches();
        } else {
          sessionSet("se_updFor", latest);
          (await navigator.serviceWorker?.getRegistration())?.update().catch(() => {});
        }
        $("appVersion").textContent = `Đang cập nhật lên phiên bản ${latest}…`;
        setTimeout(() => location.reload(), 600);
      }
    } catch { /* offline: try again later */ }
  }
  function sessionGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
  function sessionSet(k, v) { try { sessionStorage.setItem(k, String(v)); } catch { /* private mode */ } }
  // Drops the offline copy of the app (service worker + its caches). Saved words, videos etc. are not touched.
  async function clearAppCaches() {
    try {
      for (const r of (await navigator.serviceWorker?.getRegistrations()) || []) await r.unregister();
      for (const k of (await caches?.keys()) || []) if (k.startsWith("shadow-english-")) await caches.delete(k); // keep the AI voice
    } catch { /* nothing to clear */ }
  }
  function showUpdateButton(latest) {
    $("appVersion").innerHTML = `Có phiên bản ${latest} · <button type="button" class="linkish">Cập nhật</button>`;
    $("appVersion").querySelector("button").onclick = () => { location.href = location.pathname + "?reset"; };
  }
  // Rescue address …/LearningEnglish/?reset : clears the app's offline copy and loads the newest version.
  if (/[?&]reset\b/.test(location.search)) {
    clearAppCaches().then(() => location.replace(location.pathname));
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkForUpdate(); });
  setInterval(checkForUpdate, 30 * 60000);
  setTimeout(checkForUpdate, 3000);
})();
