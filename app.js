(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const synth = window.speechSynthesis;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  const state = {
    dialog: null,        // { title, speakers, lines, source }
    voices: [],
    voiceA: null,
    voiceB: null,
    rate: 0.9,
    playToken: 0,        // bump to cancel a running playback sequence
    selected: -1,        // index of line being shadowed
    recording: null,     // { recorder, recognition, chunks }
    myAudioUrl: null,
    aiEngine: null,
  };

  // ---------- Voices ----------
  function loadVoices() {
    const all = synth.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
    if (!all.length) return;
    // Prefer natural/online voices, then US/GB.
    const rank = (v) =>
      (/natural|online|neural/i.test(v.name) ? 0 : 2) + (/en[-_](US|GB)/i.test(v.lang) ? 0 : 1);
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
  // Try to pick a voice that sounds different (different name, ideally opposite gender keyword).
  function pickDifferentVoice(a) {
    const female = /female|zira|aria|jenny|sonia|libby|samantha|susan|hazel|emma|ava|michelle|karen/i;
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
  function speak(text, voice, rate, onWord) {
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
    document.querySelectorAll(".line.active").forEach((el) => el.classList.remove("active"));
    clearWordHighlight();
  }
  const voiceFor = (i) => (state.dialog.lines[i][0] === 0 ? state.voiceA : state.voiceB);

  async function playLine(i, rate = state.rate, token = ++state.playToken) {
    synth.cancel();
    const li = $("dialog").children[i];
    document.querySelectorAll(".line.active").forEach((el) => el.classList.remove("active"));
    li?.classList.add("active");
    li?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const words = li ? [...li.querySelectorAll(".w")] : [];
    await speak(state.dialog.lines[i][1], voiceFor(i), rate, (ci) => highlightWord(words, ci));
    if (token === state.playToken) { li?.classList.remove("active"); clearWordHighlight(); }
    return token === state.playToken; // false = cancelled
  }

  async function playAll() {
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

  // ---------- Dialog generation (no API) ----------
  // "I want to practice a conversation about space travel" -> "space travel"
  function cleanTopic(topic) {
    return topic.trim().replace(/\s+/g, " ").replace(/[.?!]+$/, "")
      .replace(/^(i (want|would like|'d like) to )?(talk|chat|learn|practi[cs]e|speak)( about| on)? /i, "")
      .replace(/^(an? )?(conversation|dialog(ue)?|chat)( about| on)? /i, "")
      .replace(/^about /i, "") || topic.trim();
  }

  const STOPWORDS = new Set("a an the i im i'm me my we our you your to at in on of for and or with about is are was be want wanna would like go going get getting how what some new first".split(" "));
  const keywordHit = (w, k) => w === k || (w.length > 3 && (k.startsWith(w) || w.startsWith(k)));

  // Returns the best library dialog, and whether it covers the whole topic
  // ("order food" -> exact; "space travel" -> partial, because "space" isn't covered).
  function matchLibrary(topic) {
    const words = tokenize(topic).filter((w) => !STOPWORDS.has(w));
    let best = null, bestScore = 0;
    for (const d of window.DIALOGS) {
      let score = 0;
      for (const w of words) for (const k of d.keywords) if (keywordHit(w, k)) score += w === k ? 3 : 1;
      if (score > bestScore) { bestScore = score; best = d; }
    }
    if (!best || bestScore < 2) return { best: null, exact: false };
    const exact = words.every((w) => best.keywords.some((k) => keywordHit(w, k)));
    return { best: { ...best, source: "Built-in library" }, exact };
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
      source: "Simple template (on-device AI isn't available in this browser)",
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

  async function loadEngine(model) {
    if (state.aiEngine && state.aiModelId === model.id) return state.aiEngine;
    const status = $("aiStatus");
    status.textContent = `Starting the free on-device AI (${model.label})… The first time, the model downloads once (${model.size}); after that it loads from your browser cache.`;
    const webllm = await import("https://esm.run/@mlc-ai/web-llm");
    if (state.aiEngine) { await state.aiEngine.unload(); state.aiEngine = null; }
    state.aiEngine = await webllm.CreateMLCEngine(model.id, {
      initProgressCallback: (p) => { status.textContent = p.text; },
    });
    state.aiModelId = model.id;
    return state.aiEngine;
  }

  function buildPrompt(topic, level, a, b) {
    const L = LEVELS[level];
    return [
      { role: "system", content:
        `You are an experienced English teacher who writes realistic conversations for ${level} (CEFR ${L.cefr}) learners. ${L.style} ` +
        `Every sentence must be grammatically correct, natural, and something a real person would actually say. ` +
        `Stay on the topic. No narration, no stage directions, no emojis, no translations, no explanations.` },
      { role: "user", content:
        `Write a conversation between ${a} and ${b} about: "${topic}".\n` +
        `Rules:\n` +
        `- 10 to 14 lines. ${a} and ${b} take turns.\n` +
        `- Each line has at most ${L.maxWords} words.\n` +
        `- Open naturally, stay on the topic, and end the conversation naturally.\n` +
        `- Include useful phrases a learner can reuse in real life.\n` +
        `Output only the conversation, one line per turn, in this format:\n${a}: ...\n${b}: ...` },
    ];
  }

  // Automatic checks. Returns a list of problems (empty = passed).
  function checkQuality({ lines }, level) {
    const L = LEVELS[level];
    const p = [];
    if (lines.length < 8) p.push("too short");
    if (lines.length > 18) p.push("too long");
    const counts = [0, 0];
    lines.forEach(([s]) => counts[s]++);
    if (Math.min(...counts) < 3) p.push("one speaker barely talks");
    for (let i = 2; i < lines.length; i++)
      if (lines[i][0] === lines[i - 1][0] && lines[i][0] === lines[i - 2][0]) { p.push("speakers don't take turns"); break; }
    const seen = new Set();
    if (lines.some(([, t]) => { const k = norm(t.replace(/\s/g, "")); return seen.has(k) || !seen.add(k); })) p.push("repeated lines");
    // Same 3-word phrase in 3+ lines ("that way we", "that's a good idea") = lazy, repetitive writing.
    const phraseLines = new Map();
    lines.forEach(([, t]) => {
      const w = tokenize(t);
      new Set(w.slice(2).map((_, i) => w.slice(i, i + 3).join(" "))).forEach((ph) => phraseLines.set(ph, (phraseLines.get(ph) || 0) + 1));
    });
    const repeated = [...phraseLines].filter(([, n]) => n >= 3).map(([ph]) => `"${ph}"`);
    if (repeated.length) p.push("repetitive phrases " + repeated.slice(0, 2).join(", "));
    if (lines.filter(([, t]) => t.split(/\s+/).length > L.maxWords * 1.3).length > 2) p.push(`sentences too long for ${level}`);
    if (lines.some(([, t]) => /[^\x00-\x7F‘’“”—–…éè]/.test(t))) p.push("non-English text");
    if (lines.some(([, t]) => BAD_WORDS.test(t))) p.push("inappropriate language");
    if (lines.some(([, t]) => /\b(as an ai|language model|here is (a|the) conversation)\b/i.test(t))) p.push("contains AI meta-text");
    return p;
  }

  async function aiDialog(topic) {
    if (!navigator.gpu) throw new Error("Your browser doesn't support WebGPU. Try the latest Chrome or Edge.");
    const status = $("aiStatus");
    status.hidden = false;
    const model = AI_MODELS[$("aiModel").value] || AI_MODELS.fast;
    const level = $("level").value;
    const engine = await loadEngine(model);
    topic = cleanTopic(topic);

    // Generate, check, and retry; keep the attempt with the fewest problems.
    let best = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      status.textContent = attempt === 1
        ? `Writing a new ${level} dialog about "${topic}"…`
        : `Attempt ${attempt} of ${MAX_ATTEMPTS}: the last one had problems (${best.problems.join(", ")}), trying again…`;
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
    if (best.lines.length < 4) throw new Error("The AI reply couldn't be understood. Please try again.");

    status.textContent = best.problems.length
      ? `⚠ Best of ${MAX_ATTEMPTS} attempts, but some checks failed: ${best.problems.join(", ")}. Use ✏️ Edit to fix it, or 🔄 New version.`
      : "✓ Passed all quality checks. Same topic again gives a different conversation.";
    const title = topic.replace(/\b\w/g, (c) => c.toUpperCase());
    return { title, topic, speakers: best.speakers, lines: best.lines, level, source: `On-device AI (${model.label})` };
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
      const text = m[2]
        .replace(/\([^)]*\)|\[[^\]]*\]|\*[^*]+\*/g, "")        // (laughs) [smiles] *waves*
        .replace(/\p{Extended_Pictographic}/gu, "")                 // emojis
        .replace(/^["“]|["”]$/g, "").replace(/\s+/g, " ").trim();
      if (text) lines.push([idx, text]);
    }
    if (speakers.length < 2) speakers.push("Friend");
    const spare = ["Sam", "Mia", "Leo", "Nina"].filter((n) => !speakers.includes(n));
    for (let i = 0; i < speakers.length; i++) if (speakers[i].startsWith("~")) speakers[i] = spare.shift();
    return { speakers, lines };
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
      const { id, title, speakers, lines, level, source } = d;
      saved.unshift({ id, title, speakers, lines, level, source, savedAt: Date.now() });
    }
    if (!safeSet("saved", saved)) alert("Couldn't save. Your browser may be blocking storage (private window?).");
    updateSaveBtn();
    renderSaved();
  }
  function updateSaveBtn() {
    const on = state.dialog && isSaved(state.dialog.id);
    $("saveBtn").textContent = on ? "★ Saved" : "☆ Save";
    $("saveBtn").classList.toggle("saved", on);
  }
  function renderSaved() {
    const saved = getSaved();
    $("savedSection").hidden = false;
    $("savedEmpty").hidden = saved.length > 0;
    $("exportBtn").disabled = !saved.length;
    $("savedList").innerHTML = saved.map((d) => `
      <li data-id="${esc(d.id)}">
        <button class="open" title="Open">${esc(d.title)} <small>${new Date(d.savedAt).toLocaleDateString()}</small></button>
        <button class="del ghost" title="Remove">✕</button>
      </li>`).join("");
  }
  function onSavedClick(e) {
    const li = e.target.closest("li");
    if (!li) return;
    const d = getSaved().find((x) => x.id === li.dataset.id);
    if (!d) return;
    if (e.target.closest(".del")) {
      if (!confirm(`Remove "${d.title}" from your saved dialogs?`)) return;
      safeSet("saved", getSaved().filter((x) => x.id !== d.id));
      renderSaved();
      if (state.dialog?.id === d.id) updateSaveBtn();
    } else if (e.target.closest(".open")) {
      render({ ...d });
    }
  }

  // Export/import as a .json file, to back up or move to another device.
  function exportSaved() {
    const blob = new Blob([JSON.stringify(getSaved(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `shadow-english-dialogs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function importSaved(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) throw 0;
      const valid = data.filter((d) => d && d.id && d.title && Array.isArray(d.speakers) && Array.isArray(d.lines));
      const saved = getSaved();
      const have = new Set(saved.map((d) => d.id));
      const added = valid.filter((d) => !have.has(d.id)).map((d) => ({ ...d, savedAt: d.savedAt || Date.now() }));
      safeSet("saved", [...added, ...saved]);
      renderSaved();
      updateSaveBtn();
      alert(`Imported ${added.length} dialog(s).`);
    } catch {
      alert("That file isn't a Shadow English export.");
    }
  }

  // ---------- Fixing a dialog: regenerate or edit by hand ----------
  async function regenerate() {
    const d = state.dialog;
    $("topicInput").value = d.topic || d.title;
    $("regenBtn").disabled = true;
    try {
      render(await aiDialog(d.topic || d.title));
    } catch (err) {
      $("aiStatus").hidden = false;
      $("aiStatus").textContent = "The on-device AI couldn't run: " + err.message;
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
      $("editBtn").textContent = "✓ Done editing";
      document.querySelectorAll("#dialog .text").forEach((el) => {
        el.textContent = el.textContent; // drop word spans while editing
        el.contentEditable = "plaintext-only";
      });
      document.querySelector("#dialog .text")?.focus();
      return;
    }
    // Copy the lines so editing never changes the built-in library.
    const texts = [...document.querySelectorAll("#dialog .text")].map((el) => el.textContent.replace(/\s+/g, " ").trim());
    const d = state.dialog;
    d.lines = d.lines.map(([s, t], i) => [s, texts[i] || t]);
    if (!/edited/.test(d.source)) d.source += " · edited";
    if (isSaved(d.id)) {
      safeSet("saved", getSaved().map((x) => (x.id === d.id ? { ...x, lines: d.lines, source: d.source } : x)));
      renderSaved();
    }
    render(d);
  }

  // ---------- Rendering ----------
  function render(d) {
    stopAll();
    closeShadow();
    if (!d.id) d.id = "u" + Date.now(); // AI/template dialogs get an id so they can be saved
    state.dialog = d;
    $("dialogSection").hidden = false;
    $("dialogTitle").textContent = d.title;
    $("dialogMeta").textContent = `${d.level} · ${d.speakers.join(" & ")} · ${d.source}`;
    updateSaveBtn();
    state.editing = false;
    document.body.classList.remove("editing");
    $("editBtn").textContent = "✏️ Edit";
    $("regenBtn").hidden = !navigator.gpu;
    const ol = $("dialog");
    ol.innerHTML = "";
    d.lines.forEach(([s, text], i) => {
      const li = document.createElement("li");
      li.className = "line " + (s === 0 ? "a" : "b");
      li.innerHTML = `
        <button class="play" title="Listen">🔊</button>
        <div class="bubble" title="Click to shadow this sentence">
          <div class="speaker">${esc(d.speakers[s])}</div>
          <div class="text">${wrapWords(text)}</div>
        </div>`;
      li.querySelector(".play").onclick = () => playLine(i);
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
  function openShadow(i) {
    stopAll();
    stopRecording(true);
    state.selected = i;
    document.querySelectorAll(".line.selected").forEach((el) => el.classList.remove("selected"));
    $("dialog").children[i].classList.add("selected");
    const [s, text] = state.dialog.lines[i];
    $("shadowWho").textContent = state.dialog.speakers[s];
    $("shadowPos").textContent = `Line ${i + 1} of ${state.dialog.lines.length}`;
    $("shadowText").textContent = text;
    $("result").hidden = true;
    $("prevLine").disabled = i === 0;
    $("nextLine").disabled = i === state.dialog.lines.length - 1;
    $("shadowNote").textContent = Recognition
      ? "Tip: Listen first, then press Record and say the sentence. Press again to stop."
      : "Your browser can't check pronunciation (use Chrome or Edge), but you can still record and compare.";
    $("shadow").hidden = false;
  }
  function closeShadow() {
    stopRecording(true);
    $("shadow").hidden = true;
    document.querySelectorAll(".line.selected").forEach((el) => el.classList.remove("selected"));
    state.selected = -1;
  }

  // Play the line, then stay silent for about as long as the line took so the learner can repeat it.
  async function shadowLoop(times = 3) {
    const token = ++state.playToken;
    for (let n = 0; n < times; n++) {
      $("shadowNote").textContent = `Round ${n + 1} of ${times}: listen…`;
      const t0 = performance.now();
      if (!(await playLine(state.selected, state.rate, token))) return;
      const dur = performance.now() - t0;
      $("shadowNote").textContent = `Round ${n + 1} of ${times}: now you say it!`;
      await wait(Math.max(1500, dur * 1.3));
      if (token !== state.playToken) return;
    }
    $("shadowNote").textContent = "Nice work! Press Record to check your pronunciation.";
  }

  async function toggleRecording() {
    if (state.recording) return stopRecording();
    stopAll();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      $("shadowNote").textContent = "Microphone access was blocked. Allow the mic in your browser's address bar and try again.";
      return;
    }
    const rec = { chunks: [], stream, transcript: "", finished: false };
    rec.recorder = new MediaRecorder(stream);
    rec.recorder.ondataavailable = (e) => e.data.size && rec.chunks.push(e.data);
    rec.recorder.onstop = () => {
      if (state.myAudioUrl) URL.revokeObjectURL(state.myAudioUrl);
      state.myAudioUrl = URL.createObjectURL(new Blob(rec.chunks, { type: rec.recorder.mimeType }));
      stream.getTracks().forEach((t) => t.stop());
    };
    rec.recorder.start();

    if (Recognition) {
      const r = new Recognition();
      r.lang = "en-US";
      r.interimResults = true;
      r.continuous = true;
      r.onresult = (e) => {
        rec.transcript = [...e.results].map((x) => x[0].transcript).join(" ");
        $("shadowNote").textContent = "Hearing: " + rec.transcript;
      };
      r.onerror = (e) => {
        if (e.error === "not-allowed") $("shadowNote").textContent = "Speech recognition was blocked. You can still compare recordings.";
        else if (e.error === "network") $("shadowNote").textContent = "Speech recognition needs an internet connection in this browser.";
      };
      r.onend = () => { if (state.recording === rec) stopRecording(); };
      r.start();
      rec.recognition = r;
    }
    state.recording = rec;
    $("recordBtn").classList.add("on");
    $("recordBtn").textContent = "⏹ Stop";
    $("shadowNote").textContent = "Recording… say the sentence.";
  }

  function stopRecording(silent = false) {
    const rec = state.recording;
    if (!rec) return;
    state.recording = null;
    $("recordBtn").classList.remove("on");
    $("recordBtn").textContent = "🎙️ Record";
    try { rec.recognition?.stop(); } catch {}
    if (rec.recorder.state !== "inactive") rec.recorder.stop();
    if (silent) return;
    // Give recognition a moment to deliver its final result.
    setTimeout(() => showResult(rec.transcript), Recognition ? 400 : 0);
  }

  function showResult(transcript) {
    $("result").hidden = false;
    const target = state.dialog.lines[state.selected][1];
    if (!Recognition) {
      $("scoreNum").textContent = "–";
      $("diff").textContent = target;
      $("heard").textContent = "(speech checking isn't supported in this browser)";
      return;
    }
    const { html, score } = compareWords(target, transcript);
    $("scoreNum").textContent = score;
    $("diff").innerHTML = html;
    $("heard").textContent = transcript || "(nothing — try speaking a bit louder)";
    $("shadowNote").textContent =
      score >= 90 ? "Excellent! 🎉 Try the next line." :
      score >= 70 ? "Good job! Listen again and focus on the red words." :
      "Keep practising. Try Slow mode, then Shadow ×3.";
  }

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
    return { html, score };
  }
  // Normalise a word so "Don't" == "dont", "10" == "ten", etc.
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
  function safeSet(k, v) { try { localStorage.setItem("se_" + k, JSON.stringify(v)); return true; } catch { return false; } }

  // ---------- Wire up ----------
  async function onSubmit(e) {
    e?.preventDefault();
    const topic = $("topicInput").value.trim();
    if (!topic) return $("topicInput").focus();
    const btn = $("topicForm").querySelector("button");
    const { best, exact } = matchLibrary(cleanTopic(topic));
    $("aiStatus").hidden = true;

    // 1. Common topic we already have a hand-written dialog for: instant.
    if (best && exact && !$("aiMode").checked) return render(best);

    // 2. Anything else: write a new dialog with the free on-device AI.
    if (navigator.gpu) {
      btn.disabled = true;
      btn.textContent = "Writing…";
      try {
        return render(await aiDialog(topic));
      } catch (err) {
        $("aiStatus").hidden = false;
        $("aiStatus").textContent = "The on-device AI couldn't run: " + err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = "Create dialog";
      }
    } else {
      $("aiStatus").hidden = false;
      $("aiStatus").textContent = "This browser can't run the on-device AI (needs WebGPU: latest Chrome or Edge), so a simpler dialog is shown.";
    }

    // 3. Fallback: closest library dialog, or a template.
    render(best || templateDialog(topic));
  }

  function init() {
    if (!synth) {
      document.body.insertAdjacentHTML("afterbegin", `<p style="background:#fee;padding:10px;text-align:center">Your browser doesn't support text-to-speech. Please use Chrome, Edge or Safari.</p>`);
    } else {
      loadVoices();
      synth.onvoiceschanged = loadVoices;
    }

    $("chips").innerHTML = window.DIALOGS.map((d) => `<button data-t="${esc(d.keywords[0])}">${d.emoji} ${esc(d.title)}</button>`).join("");
    $("chips").onclick = (e) => {
      const b = e.target.closest("button");
      if (b) { $("topicInput").value = b.dataset.t; onSubmit(); }
    };

    $("topicForm").onsubmit = onSubmit;
    $("aiMode").checked = !!safeGet("alwaysAi");
    $("aiMode").onchange = () => safeSet("alwaysAi", $("aiMode").checked);
    $("playAllBtn").onclick = playAll;
    $("stopBtn").onclick = stopAll;
    $("saveBtn").onclick = toggleSave;
    $("regenBtn").onclick = regenerate;
    $("editBtn").onclick = toggleEdit;
    for (const id of ["level", "aiModel"]) {
      const v = safeGet(id);
      if (v) $(id).value = v;
      $(id).onchange = () => safeSet(id, $(id).value);
    }
    $("savedList").onclick = onSavedClick;
    $("exportBtn").onclick = exportSaved;
    $("importBtn").onclick = () => $("importFile").click();
    $("importFile").onchange = (e) => { if (e.target.files[0]) importSaved(e.target.files[0]); e.target.value = ""; };
    renderSaved();
    $("rate").oninput = (e) => { state.rate = +e.target.value; $("rateVal").textContent = state.rate.toFixed(2).replace(/0$/, "") + "×"; };
    $("hideText").onchange = (e) => document.body.classList.toggle("hide-text", e.target.checked);

    $("listenBtn").onclick = () => playLine(state.selected);
    $("slowBtn").onclick = () => playLine(state.selected, Math.max(0.5, state.rate - 0.3));
    $("loopBtn").onclick = () => shadowLoop(3);
    $("recordBtn").onclick = toggleRecording;
    $("prevLine").onclick = () => openShadow(state.selected - 1);
    $("nextLine").onclick = () => openShadow(state.selected + 1);
    $("closeShadow").onclick = closeShadow;
    $("playMine").onclick = () => { if (state.myAudioUrl) { stopAll(); new Audio(state.myAudioUrl).play(); } };
    $("playOrig").onclick = () => playLine(state.selected);

    $("settingsBtn").onclick = () => $("settings").showModal();
    $("voiceA").onchange = $("voiceB").onchange = saveVoices;

    document.addEventListener("keydown", (e) => {
      if (state.selected < 0 || e.target.matches("input, select, textarea")) return;
      if (e.key === "ArrowRight" && state.selected < state.dialog.lines.length - 1) openShadow(state.selected + 1);
      else if (e.key === "ArrowLeft" && state.selected > 0) openShadow(state.selected - 1);
      else if (e.key === " ") { e.preventDefault(); playLine(state.selected); }
      else if (e.key.toLowerCase() === "r") toggleRecording();
      else if (e.key === "Escape") closeShadow();
    });
  }

  init();
})();
