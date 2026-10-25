// Natural AI voice, free: Kokoro (open model, Apache-2.0) running on this computer's graphics card (WebGPU).
// Measured: ~0.6 s to make 3 s of speech after the first sentence; first use downloads the model (~330 MB) once.
// Every sentence spoken is kept in the browser (Cache Storage), so replaying it is instant and works offline.
// Without WebGPU, and on iPhone/iPad, it is off: there the model is too heavy to make a sentence quickly, and
// iPhone only plays sound that starts right after a tap, so a sentence ready seconds later stayed silent.
// iPhone uses Google's voice instead (app.js).
(() => {
  "use strict";
  const SE = window.SE;
  const $ = (id) => document.getElementById(id);
  const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
  const LIB = "https://cdn.jsdelivr.net/npm/kokoro-js@1/+esm";
  const CACHE = "se-voice-v1";
  const VOICES = [
    ["af_heart", "Heart (nữ, Mỹ, tự nhiên nhất)"], ["af_bella", "Bella (nữ, Mỹ)"], ["bf_emma", "Emma (nữ, Anh)"],
    ["am_michael", "Michael (nam, Mỹ)"], ["am_fenrir", "Fenrir (nam, Mỹ)"], ["am_puck", "Puck (nam, Mỹ)"], ["bm_george", "George (nam, Anh)"],
  ];

  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const supported = !!navigator.gpu && !isIOS;
  // Turned on earlier on an iPhone: switch it off and free the downloaded model (about 330 MB) and its sentences.
  if (isIOS && SE.safeGet("aiVoice")) {
    SE.safeSet("aiVoice", false);
    caches.keys().then((keys) => keys.filter((k) => k === CACHE || /transformers/i.test(k)).forEach((k) => caches.delete(k))).catch(() => {});
  }
  const V = { tts: null, loading: null, audio: null, mem: new Map() };
  const enabled = () => supported && !!SE.safeGet("aiVoice");
  const voiceFor = (which) => SE.safeGet(which === "B" ? "aiVoiceB" : "aiVoiceA") || (which === "B" ? "am_michael" : "af_heart");

  function status(t) { const el = $("aiVoiceStatus"); if (el) el.textContent = t; }

  // Load the model once (downloads ~330 MB the first time; later from the browser's cache).
  function load() {
    if (V.tts) return Promise.resolve(V.tts);
    V.loading ||= (async () => {
      status("Đang tải giọng AI… (lần đầu khoảng 330 MB, những lần sau mở ngay)");
      const { KokoroTTS } = await import(LIB);
      const seen = {};
      V.tts = await KokoroTTS.from_pretrained(MODEL, {
        dtype: "fp32", device: "webgpu",
        progress_callback: (p) => {
          if (p.status !== "progress" || !p.total) return;
          seen[p.file] = [p.loaded, p.total];
          const [l, t] = Object.values(seen).reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
          status(`Đang tải giọng AI… ${Math.round(l / 1048576)} / ${Math.round(t / 1048576)} MB`);
        },
      });
      status("✓ Giọng AI đã sẵn sàng.");
      return V.tts;
    })().catch((err) => { V.loading = null; status("⚠ Không tải được giọng AI: " + (err.message || err)); throw err; });
    return V.loading;
  }

  // Audio for one sentence: memory → browser cache → generate (then store).
  const key = (voice, text) => `https://voice.local/${voice}/${encodeURIComponent(text)}`;
  async function audioFor(text, voice) {
    const k = key(voice, text);
    if (V.mem.has(k)) return V.mem.get(k);
    const job = (async () => {
      const cache = await caches.open(CACHE).catch(() => null);
      const hit = await cache?.match(k);
      if (hit) return hit.blob();
      const tts = await load();
      const blob = (await tts.generate(text, { voice })).toBlob();
      cache?.put(k, new Response(blob, { headers: { "Content-Type": "audio/wav" } })).catch(() => {});
      return blob;
    })();
    V.mem.set(k, job);
    if (V.mem.size > 300) V.mem.delete(V.mem.keys().next().value);
    job.catch(() => V.mem.delete(k));
    return job;
  }

  // Speak; resolves when finished or stopped. Returns false if the AI voice can't be used right now
  // (still loading the first time, or failed): the caller then uses the device voice.
  async function speak(text, which = "A", rate = 1) {
    if (!enabled() || !text?.trim()) return false;
    if (!V.tts) { load().catch(() => {}); return false; } // first time: device voice while the model downloads
    let blob;
    try { blob = await audioFor(text.trim(), voiceFor(which)); } catch { return false; }
    stop();
    return new Promise((resolve) => {
      const a = (V.audio = new Audio(URL.createObjectURL(blob)));
      a.playbackRate = rate;
      a.preservesPitch = true;
      const done = () => { URL.revokeObjectURL(a.src); if (V.audio === a) V.audio = null; resolve(true); };
      a.onended = a.onerror = a.onpause = done;
      // Blocked (iPhone: sound must start right after a tap, and making the audio took a moment): say so,
      // so the caller uses another voice instead of staying silent.
      a.play().catch(() => { URL.revokeObjectURL(a.src); if (V.audio === a) V.audio = null; resolve(false); });
    });
  }
  function stop() { if (V.audio) { const a = V.audio; V.audio = null; a.pause(); } }
  // Prepare a sentence in the background (next line of a dialog).
  function prefetch(text, which = "A") { if (enabled() && V.tts && text) audioFor(text.trim(), voiceFor(which)).catch(() => {}); }

  // ---------- Settings ----------
  function settingsUi() {
    const box = $("aiVoiceBox");
    if (!box) return;
    if (isIOS) {
      box.innerHTML = `<p class="hint small">✨ <b>Giọng AI tự nhiên</b> chỉ dùng trên máy tính. Trên iPhone, app đọc bằng <b>giọng Google</b> (giọng Mỹ, người nói thứ hai giọng Anh) và từ vựng bằng <b>bản ghi âm Oxford</b>.</p>`;
      return;
    }
    if (!supported) {
      box.innerHTML = `<p class="hint small">✨ <b>Giọng AI tự nhiên</b> cần máy tính có card đồ hoạ (Chrome hoặc Edge). Trên <b>iPhone</b>, tải giọng Siri chất lượng cao miễn phí: <b>Cài đặt → Trợ năng → Nội dung được đọc → Giọng nói → Tiếng Anh</b> → chọn một giọng có chữ <b>“Nâng cao”</b> hoặc <b>“Cao cấp”</b> (ví dụ Ava, Zoe, Evan) → tải về. Sau đó mở lại app và chọn giọng đó ở ô Người nói A/B bên dưới.</p>`;
      return;
    }
    const opts = (sel) => VOICES.map(([id, name]) => `<option value="${id}" ${id === sel ? "selected" : ""}>${name}</option>`).join("");
    box.innerHTML = `<label class="toggle"><input type="checkbox" id="aiVoiceOn" ${enabled() ? "checked" : ""} /> ✨ <b>Giọng AI tự nhiên</b> (miễn phí, chạy trên máy này, tải khoảng 330 MB một lần)</label>
      <div class="ai-voice-opts" ${enabled() ? "" : "hidden"}>
        <label>Giọng người nói A <select class="select" id="aiVoiceA">${opts(voiceFor("A"))}</select></label>
        <label>Giọng người nói B <select class="select" id="aiVoiceB">${opts(voiceFor("B"))}</select></label>
        <button type="button" class="btn small" id="aiVoiceTest">🔊 Nghe thử</button>
      </div>
      <p class="hint small" id="aiVoiceStatus">${V.tts ? "✓ Giọng AI đã sẵn sàng." : ""}</p>`;
    $("aiVoiceOn").onchange = (e) => {
      SE.safeSet("aiVoice", e.target.checked);
      box.querySelector(".ai-voice-opts").hidden = !e.target.checked;
      if (e.target.checked) load().catch(() => {});
    };
    $("aiVoiceA").onchange = (e) => SE.safeSet("aiVoiceA", e.target.value);
    $("aiVoiceB").onchange = (e) => SE.safeSet("aiVoiceB", e.target.value);
    $("aiVoiceTest").onclick = async () => {
      await load().catch(() => {});
      await speak("Hi there! I'm your English practice partner. Shall we start?", "A", 1);
      await speak("Sure. Let's practise ordering coffee together.", "B", 1);
    };
  }
  $("settings")?.addEventListener("close", stop);
  settingsUi();
  document.getElementById("settingsBtn")?.addEventListener("click", settingsUi);
  // Warm up quietly if the learner already turned it on (model comes from the browser cache after the first time).
  if (enabled()) load().catch(() => {});

  window.SE_VOICE = { enabled, speak, stop, prefetch, refreshSettings: settingsUi };
})();
