// Section 2: "Từ vựng", the learner's word list, shown as a table:
// word | part of speech + IPA | listen + say it | Oxford meaning | Vietnamese meaning | 3 common examples.
// Words come from: clicking a word in the video subtitles, the box under a video, selecting text anywhere
// in the app, or right-click "Save word to LearningEnglish" in the browser extension.
// Review schedule (days after each review): 2, 4, 7, 14 and 30, at most 10 words a day.
// After the last one it is "đã thuộc". On a flashcard the answer is the word's list: 🗣 Speaking (6 times)
// or 📖 Reading (3 times); either one moves the word on to its next step.
// Word families (metabolism, metabolic, metabolize) sit together in the table and are learned on the same day.
// "Nghe" plays Oxford Learner's Dictionaries' own recording of the word.
// On the phone: 📋 Dán (a word or sentence copied in any app), the iPhone Share menu shortcut (#share=)
// and the Android Share menu; a sentence opens a picker to choose which words to keep.
(() => {
  "use strict";
  const SE = window.SE;
  const $ = (id) => document.getElementById(id);
  const esc = SE.esc;
  const DAY = 86400000;
  // Stage 0 = new (saved, not learned yet). Learning it = its first review; then each review comes
  // 2, 4, 7, 14 and 30 days after the one before. After review 5 the word is learned (MASTERED).
  // A word studied today never comes back tomorrow (that day goes to other words), whatever the answer.
  // Two lists: words for Speaking are studied 6 times (learning + 5 reviews); words for Reading, too hard to say
  // and only needed to understand, 3 times (learning, then after 4 days and 2 weeks). Speaking comes first.
  // A word with no list yet counts as Speaking; the list is chosen on the flashcard or in the table.
  const OFFSETS = [2, 4, 7, 14, 30];
  const READ_OFFSETS = [4, 14];
  const FUZZ = [1, 1, 2, 3, 3];        // days a review may move to keep days under the limit (the first only later)
  const MASTERED = OFFSETS.length + 1; // a Speaking word's last step
  const isReading = (w) => w.use === "reading";
  const gaps = (w) => (isReading(w) ? READ_OFFSETS : OFFSETS);
  const doneAt = (w) => gaps(w).length + 1; // 6 for Speaking, 3 for Reading
  const known = (w) => w.stage >= doneAt(w);
  const DAILY = 10;                    // at most 10 words a day: reviews that are due first, then new words
  const NEW_MIN = 3;                   // …but always room for 3 new words, so every saved word gets its turn
  const pref = (k, d) => { try { return localStorage.getItem("se_" + k) ?? d; } catch { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem("se_" + k, v); } catch { /* private mode */ } };
  const ui = { q: "", f: "all", review: null, group: pref("wordsGroup", "1") === "1", accent: pref("accent", "gb") };

  const list = () => (SE.safeGet("words") || []).map(upgrade);
  function saveList(items) { SE.safeSet("words", items); updateNav(); }
  function update(id, patch) {
    saveList(list().map((x) => (x.id === id ? { ...x, ...patch } : x)));
    if (!$("view-words").hidden && !ui.review) renderList();
  }
  const toast = (t) => window.SE_LIB?.toast(t);
  const clean = (w) => (w || "").replace(/[’‘]/g, "'").replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "").trim();
  const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const today = () => startOfDay(Date.now());
  const isDue = (w) => w.stage >= 1 && !known(w) && w.due != null && startOfDay(w.due) <= today();
  const reviewedToday = (w) => w.lastReview && startOfDay(w.lastReview) === today();
  // ---------- Word families ----------
  // metabolism, metabolic, metabolize, metabolically → family "metabol": common endings are taken off
  // (up to 3 times, keeping at least 4 letters). Good for most families; a wrong match is fixed by hand
  // with "Tách khỏi họ" (familyKey = the word itself). Words added from the suggestions keep the family's key.
  const SUFFIXES = ["ically", "ization", "isation", "ational", "fulness", "iveness", "ability", "ibility", "ation", "ition",
    "ments", "ment", "ness", "ical", "ally", "ably", "ibly", "ism", "ist", "ity", "ive", "ize", "ise", "ous", "ful", "less",
    "able", "ible", "ence", "ance", "ency", "ancy", "ent", "ant", "ion", "ic", "al", "ly", "er", "or", "s", "y", "e", "i"]
    .sort((a, b) => b.length - a.length);
  function rootOf(word) {
    let w = (word || "").toLowerCase().trim();
    if (!/^[a-z]+$/.test(w)) return w; // phrases are a family of their own
    for (let pass = 0; pass < 3; pass++) {
      const x = SUFFIXES.find((x) => w.endsWith(x) && w.length - x.length >= 4 && !(x === "s" && /[sui]s$/.test(w)));
      if (!x) break;
      w = w.slice(0, -x.length);
    }
    return w;
  }
  const famKey = (w) => w.familyKey || rootOf(w.word);
  const siblings = (w, all = list()) => all.filter((x) => x.id !== w.id && famKey(x) === famKey(w));
  // Other words of the family from Datamuse (free, with part of speech and how common the word is):
  // only real family members (same root), common enough, no plurals and no British -ise twins of -ize words.
  const famCache = new Map();
  async function suggestFamily(w) {
    const r = rootOf(w.word);
    if (!/^[a-z]{4,}$/.test(r)) return [];
    if (!famCache.has(r)) {
      famCache.set(r, fetch(`https://api.datamuse.com/words?sp=${r}*&md=pf&max=40`).then((x) => x.json()).then((rows) => {
        const out = rows.map((x) => ({ word: x.word, f: +((x.tags || []).find((t) => t.startsWith("f:")) || "f:0").slice(2),
            pos: (x.tags || []).filter((t) => /^(n|v|adj|adv)$/.test(t)) }))
          .filter((x) => /^[a-z]+$/.test(x.word) && x.f >= 0.3 && rootOf(x.word) === r);
        const set = new Set(out.map((x) => x.word));
        return out.filter((x) => !(x.word.endsWith("s") && set.has(x.word.slice(0, -1))) &&
            !(/is(e|ation|ed|ing)$/.test(x.word) && set.has(x.word.replace(/is(e|ation|ed|ing)$/, "iz$1"))))
          .sort((a, b) => b.f - a.f).slice(0, 8);
      }).catch(() => { famCache.delete(r); return []; }));
    }
    return famCache.get(r);
  }
  const POS_VI = { n: "danh từ", v: "động từ", adj: "tính từ", adv: "trạng từ" };

  // ---------- Real pronunciation ----------
  // Single words play Oxford Learner's Dictionaries' own recordings (the 🔊 on the Oxford page),
  // British or American. Oxford names the files word__gb_1.mp3 / word__us_1.mp3 (word_1__… for words with
  // several entries) in folders made of the file name's first 1, 3 and 5 letters. Phrases and words Oxford
  // doesn't have use the app's voice.
  const OX_MEDIA = "https://www.oxfordlearnersdictionaries.com/media/english/";
  const oxFile = (dir, name) => `${OX_MEDIA}${dir}/${name[0]}/${name.slice(0, 3)}/${name.slice(0, 5)}/${name}.mp3`;
  const oxFound = new Map(); // "gb:word" → working URL, or "" when Oxford has no recording
  let player = null;
  function playUrl(url) {
    return new Promise((resolve) => {
      player?.pause();
      const a = (player = new Audio(url));
      let done = false;
      const end = (ok) => { if (!done) { done = true; if (!ok) a.pause(); resolve(ok); } };
      a.onplaying = () => end(true);
      a.onerror = () => end(false);
      setTimeout(() => end(false), 5000);
      a.play().catch(() => end(false));
    });
  }
  async function sayWord(word) {
    const w = (word || "").trim().toLowerCase();
    if (!/^[a-z]+$/.test(w)) return SE.say(word);
    SE.stopAll(); // stop an example sentence that is still playing
    const order = ui.accent === "us" ? [["us_pron", "us"], ["uk_pron", "gb"]] : [["uk_pron", "gb"], ["us_pron", "us"]];
    const key = ui.accent + ":" + w;
    const known = oxFound.get(key);
    const tries = known != null ? (known ? [known] : [])
      : order.flatMap(([dir, t]) => [`${w}__${t}_1`, `${w}_1__${t}_1`, `${w}__${t}_2`].map((n) => oxFile(dir, n)));
    for (const u of tries) if (await playUrl(u)) { oxFound.set(key, u); return; }
    oxFound.set(key, "");
    return SE.say(word);
  }

  // Today's list, at most DAILY words including those already reviewed today: due reviews (most overdue,
  // then earliest step), with at least NEW_MIN places kept for new words (oldest saved first), so the list
  // moves on through every saved word. Reviews that don't fit wait for tomorrow. extra: "Học thêm" after that.
  function todayQueue(all = list(), extra = 0) {
    const left = Math.max(0, DAILY - all.filter(reviewedToday).length) + extra;
    // Speaking words before Reading words, in reviews and in new words.
    const r = (w) => (isReading(w) ? 1 : 0);
    const reviews = all.filter((w) => isDue(w) && !reviewedToday(w)).sort((a, b) => r(a) - r(b) || a.due - b.due || a.stage - b.stage);
    const freshAll = all.filter((w) => w.stage === 0 && !reviewedToday(w)).sort((a, b) => r(a) - r(b) || a.savedAt - b.savedAt);
    // A new word brings its new family members along (they are learned together).
    const fresh = [], seenF = new Set();
    for (const w of freshAll) {
      if (seenF.has(w.id)) continue;
      for (const x of freshAll) if (!seenF.has(x.id) && famKey(x) === famKey(w)) { seenF.add(x.id); fresh.push(x); }
    }
    const nNew = Math.min(fresh.length, left, Math.max(NEW_MIN, left - reviews.length));
    const chosen = [...reviews.slice(0, left - nNew), ...fresh.slice(0, nNew)];
    // Words of one family come one after another.
    const seen = new Set(), out = [];
    for (const w of chosen) {
      if (seen.has(w.id)) continue;
      for (const x of chosen) if (!seen.has(x.id) && famKey(x) === famKey(w)) { seen.add(x.id); out.push(x); }
    }
    return out;
  }
  // One answer → the word's next step. Remembered: the next step of the 2/4/7/14/30-day schedule (a new word
  // starts today). Forgotten (or remembered only after forgetting today): back to the first step, so again in
  // 2 days. A word that was studied is never "new" again.
  function advance(w, ok, failedToday = false) {
    const now = Date.now();
    if (ok && !failedToday) {
      const learnedAt = w.stage === 0 ? now : w.learnedAt || now;
      const stage = Math.min(w.stage + 1, doneAt(w));
      // A family member already answered today at the same step → the same review day, so they stay together.
      const mate = siblings(w).find((x) => x.stage === stage && x.due != null && reviewedToday(x));
      return { stage, learnedAt, lastReview: now, due: stage >= doneAt(w) ? null : mate ? mate.due : pickDay(stage, w.id, gaps(w)) };
    }
    return { stage: 1, learnedAt: now, lastReview: now, due: pickDay(1, w.id, gaps(w)) };
  }
  const due = () => todayQueue();
  // Pick the review day: today + 2/4/7/14/30 days for this step, moved up to FUZZ days earlier or later
  // only when that day is nearly full; if all those days are full, look a few days later.
  function pickDay(stage, id, steps = OFFSETS) {
    const all = list();
    const earliest = today() + OFFSETS[0] * DAY; // never tomorrow: a word studied today makes room for others
    const target = Math.max(today() + steps[stage - 1] * DAY, earliest);
    const loadOn = (day) => all.filter((x) => x.id !== id && x.stage >= 1 && !known(x) && x.due != null && startOfDay(x.due) === day).length;
    const f = FUZZ[Math.min(stage, FUZZ.length) - 1];
    let best = null;
    for (let extra = 0; extra <= 3 && (!best || best.load >= DAILY); extra++) {
      for (let k = -f; k <= f + extra; k++) {
        const day = target + k * DAY;
        if (day < earliest) continue;
        const load = loadOn(day);
        // The planned day, unless it is nearly full (7+ words): then the emptiest day nearby.
        const score = Math.max(0, load - (DAILY - 4)) * 10 + Math.abs(k);
        if (!best || score < best.score) best = { day, load, score };
      }
    }
    return best.day;
  }
  const oxfordUrl = (w) => `https://www.oxfordlearnersdictionaries.com/search/english/?q=${encodeURIComponent(w.toLowerCase())}`;
  // Words saved before the new schedule (box/due, one example) get the new fields.
  function upgrade(w) {
    // Studied before but sent back to "new" by the old "Chưa nhớ": first step, 2 days after that review.
    if (w.stage === 0 && w.lastReview) return { ...w, stage: 1, learnedAt: w.lastReview, due: startOfDay(w.lastReview) + OFFSETS[0] * DAY };
    // First step planned for the next day (old 1-day schedule): 2 days after learning instead.
    if (w.stage === 1 && w.learnedAt && w.due != null && startOfDay(w.due) < startOfDay(w.learnedAt) + OFFSETS[0] * DAY) {
      return { ...w, due: startOfDay(w.learnedAt) + OFFSETS[0] * DAY };
    }
    if (w.stage != null) return w;
    const learnedAt = w.learnedAt || w.savedAt || Date.now();
    const stage = Math.min(w.box || 0, MASTERED);
    return { ...w, learnedAt, stage, due: stage >= 1 ? startOfDay(learnedAt) + OFFSETS[Math.min(stage, OFFSETS.length) - 1] * DAY : null,
      examples: w.examples || (w.example ? [w.example] : []) };
  }

  // ---------- Saving ----------
  async function save(raw) {
    const word = clean(raw.word);
    if (!word || word.length > 60) return null;
    const key = word.toLowerCase();
    const items = list();
    const have = items.find((x) => x.word.toLowerCase() === key);
    if (have) { toast(`“${have.word}” đã có trong Từ vựng`); return have; }
    const now = Date.now();
    const it = {
      id: "w" + now.toString(36) + Math.random().toString(36).slice(2, 5),
      word: /^[A-Z][a-z]/.test(word) && word !== "I" ? word.toLowerCase() : word,
      context: (raw.context || "").replace(/\s+/g, " ").trim().slice(0, 400),
      sourceKind: raw.sourceKind || "", sourceTitle: raw.sourceTitle || "", sourceUrl: raw.sourceUrl || "", time: raw.time ?? null,
      savedAt: now, learnedAt: null, stage: 0, due: null, examples: [],
      ...(raw.familyKey ? { familyKey: raw.familyKey } : {}),
    };
    saveList([it, ...items]);
    SE.track("word");
    toast(`⭐ Đã lưu “${it.word}” vào Từ vựng`);
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
    keepWord = keepWord || !!it?.manual;
    if (!it || (it.dictSource === "oxford" && !force && it.lemmaChecked)) return;
    let patch = null;
    try {
      if (SE.geminiKey() && window.SE_LIB) patch = await oxfordViaAi(it);
    } catch { /* fall back to the free sources */ }
    if (!patch) {
      // No key: Google's dictionary (Vietnamese meanings, Oxford Languages definitions and examples, base form),
      // topped up with IPA from the free English dictionary and everyday examples from Tatoeba.
      const g = await googleDict(it.word).catch(() => null);
      // A phrase keeps its words: "take off" must not become the noun "takeoff" ("took off" → "take off" is fine).
      const phraseOk = (b) => b && (!/\s/.test(it.word) || /\s/.test(b));
      const base = keepWord || !phraseOk(g?.base) ? it.word : g.base;
      const [f, t] = await Promise.all([freeDictionary(base.toLowerCase()).catch(() => null), tatoeba(base).catch(() => [])]);
      if (g || f) {
        // Examples: one from Oxford first, then everyday sentences from Tatoeba, then the rest of Oxford's.
        // The other free dictionary's examples are left out: they are often old quotes and headlines.
        const seen = new Set();
        const pick = (arr, src) => arr.filter((x) => { const k = x.toLowerCase().replace(/[^a-z ]/g, ""); if (seen.has(k)) return false; seen.add(k); return true; }).map((x) => [x, src]);
        const both = [...pick(g?.examples || [], "Oxford"), ...pick(t, "Tatoeba")].slice(0, 3);
        const examples = both.map(([x]) => x), examplesSrc = both.map(([, src]) => src);
        patch = {
          lemma: g?.base || "", pos: g?.pos || f?.pos || "", ipa: f?.ipa || "", defEn: g?.defEn || f?.defEn || "",
          meaningVi: g?.meaningVi || "", examples, examplesSrc, exV: 2, dictSource: g ? "google" : "free",
        };
      }
    }
    if (!patch) return;
    if ((it.exV || 0) >= 3) { delete patch.examples; delete patch.examplesSrc; delete patch.exV; } // keep Cambridge/Oxford examples
    // No Vietnamese meaning (Google's dictionary didn't answer, e.g. busy for this phone): ask MyMemory.
    if (!patch.meaningVi) patch.meaningVi = await myMemoryVi(it.word).catch(() => "");
    // Save the dictionary form: "discussions" -> "discussion". The form actually seen stays in `form`
    // (to highlight it in the sentence). If the base word is already in the list, keep that one.
    const lemma = (patch.lemma || "").trim();
    delete patch.lemma;
    patch.lemmaChecked = true;
    if (!keepWord && lemma && lemma.toLowerCase() !== it.word.toLowerCase() && /^[a-z][a-z' -]*$/i.test(lemma) &&
        (!/\s/.test(it.word) || /\s/.test(lemma))) {
      const twin = list().find((x) => x.id !== id && x.word.toLowerCase() === lemma.toLowerCase());
      if (twin) {
        saveList(list().filter((x) => x.id !== id));
        toast(`“${it.word}” là dạng của “${twin.word}”, từ này đã có trong Từ vựng.`);
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
    if (twin) { toast(`“${twin.word}” đã có trong Từ vựng.`); return false; }
    update(id, { word, form: it.form || it.word, pos: "", ipa: "", defEn: "", meaningVi: "", examples: [], dictSource: null, lemmaChecked: true, manual: true });
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
      // Oxford Languages examples: the definitions' own examples first, then the extra example list.
      examples: [...(d.definitions || []).flatMap((x) => (x.entry || []).map((e) => e.example)).filter(Boolean),
                 ...(d.examples?.example || []).map((e) => e.text)]
        .map(tidy).filter((x) => { const n = x.split(" ").length; return n >= 3 && n <= 20; }),
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

  // MyMemory: free translation (no key), used when Google's dictionary gives no Vietnamese meaning.
  async function myMemoryVi(word) {
    const r = await fetch(`https://api.mymemory.translated.net/get?langpair=en|vi&q=${encodeURIComponent(word)}`);
    if (!r.ok) return "";
    const j = await r.json();
    const t = (j.responseData?.translatedText || "").normalize("NFC").trim();
    return t && t.toLowerCase() !== word.toLowerCase() && !/MYMEMORY|QUOTA/i.test(t) ? t : "";
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
      <button type="button" class="btn small" data-w="say" aria-label="Nghe từ">🔊</button>
      ${info.sentence ? `<button type="button" class="btn small" data-w="sent" aria-label="Nghe cả câu">▶ Câu</button>` : ""}
      <a class="btn small" target="_blank" rel="noopener" href="https://translate.google.com/?sl=en&tl=vi&op=translate&text=${encodeURIComponent(word)}">🌐 Dịch</a>`;
    document.body.appendChild(pop);
    place(pop, el.getBoundingClientRect());
    pop.onclick = (e) => {
      const b = e.target.closest("[data-w]");
      if (!b) return;
      if (b.dataset.w === "say") sayWord(word);
      else if (b.dataset.w === "sent") { SE.say(info.sentence); closePop(); }
      else { const { sentence, ...raw } = info; save({ ...raw, word }); closePop(); }
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
  // ---------- Tap a word in an article or speech → "⭐ Lưu từ" ----------
  // Selecting text is fiddly on a phone (and iPhone's own Copy/Look Up menu covers the save button), so a tap
  // on a word is enough, as in the video subtitles. Returns false when the tap was not on a word (the reader
  // then plays the sentence, as before).
  const WORD_CH = /[A-Za-z'’-]/;
  function tapWord(e, sentEl) {
    let node = null, at = 0;
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (r) { node = r.startContainer; at = r.startOffset; }
    } else if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(e.clientX, e.clientY);
      if (p) { node = p.offsetNode; at = p.offset; }
    }
    if (!node || node.nodeType !== 3 || !sentEl.contains(node)) return false;
    const t = node.textContent;
    let a = at, b = at;
    if (!WORD_CH.test(t[a] || "") && WORD_CH.test(t[a - 1] || "")) a = b = at - 1; // tapped just after the word
    if (!WORD_CH.test(t[a] || "")) return false;
    while (a > 0 && WORD_CH.test(t[a - 1])) a--;
    while (b < t.length && WORD_CH.test(t[b])) b++;
    const word = clean(t.slice(a, b));
    if (!word || !/[a-z]/i.test(word)) return false;
    const range = document.createRange();
    range.setStart(node, a);
    range.setEnd(node, b);
    const rect = range.getBoundingClientRect();
    popover({ getBoundingClientRect: () => rect }, { word, ...contextFor(node.parentElement), sentence: sentEl.textContent });
    return true;
  }

  // The sentence and the source (video, article, speech, dialog) around a selected word.
  function contextFor(node) {
    const sentence = node.closest(".sent, .cue-x, .sub-line, .text, .pc-ex, li, p")?.textContent || "";
    const src = node.closest("[data-src-title]");
    if (src) return { context: sentence, sourceKind: src.dataset.srcKind, sourceTitle: src.dataset.srcTitle, sourceUrl: src.dataset.srcUrl };
    if (node.closest("#dialog, .shadow-text, .rp-chat") && SE.dialog) return { context: sentence, sourceKind: "talk", sourceTitle: SE.dialog.title };
    return { context: sentence };
  }


  // ---------- Section ----------
  const dayLabel = (t) => new Date(t).toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" });
  function render() {
    const root = $("view-words");
    const all = list();
    const mastered = all.filter(known).length;
    root.innerHTML = `<div class="vhead"><div><p class="eyebrow">Phần 2 · Từ vựng</p><h2>Từ vựng</h2></div>
        <dl class="stat-list" aria-label="Thống kê từ vựng">
          <div style="--pc:var(--r5)"><dt>Tổng số từ</dt><dd>${all.length}</dd></div>
          <div style="--pc:var(--r1)"><dt>Ôn hôm nay</dt><dd>${due().length}</dd></div>
          <div style="--pc:var(--turmeric)"><dt>Từ mới chờ học</dt><dd>${all.filter((w) => w.stage === 0).length}</dd></div>
          <div style="--pc:var(--r4)"><dt>Đã thuộc</dt><dd>${mastered}</dd></div>
        </dl></div>
      <div class="panel" id="reviewBox"></div>
      <div class="words-tools">
        <form class="cmdbar" id="wordAdd">
          <span class="cmd-ic" aria-hidden="true">＋</span>
          <input class="cmd-input" name="w" placeholder="Thêm từ mới: laudable" autocomplete="off" aria-label="Thêm từ mới" />
          <button class="btn primary">Thêm</button>
          <button type="button" class="btn ghost" id="wordPaste" title="Dán từ hoặc câu đã chép ở app khác">📋 Dán</button>
        </form>
        <div class="search"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>
          <input class="input" type="search" id="wordSearch" placeholder="Tìm từ…" value="${esc(ui.q)}" /></div>
      </div>
      <div class="lib-tools">
        <div class="seg" id="wordFilter">${[["all", "Tất cả"], ["due", "Ôn hôm nay"], ["learning", "Đang học"], ["mastered", "Đã thuộc"], ["speaking", "🗣 Speaking"], ["reading", "📖 Reading"], ["video", "Từ video"]]
          .map(([k, l]) => `<button data-f="${k}" aria-pressed="${ui.f === k}">${l}</button>`).join("")}</div>
        <div class="words-opts">
          <button type="button" class="btn ghost small" id="phoneHelp">📱 Lưu từ trên điện thoại</button>
          <label class="fam-toggle"><input type="checkbox" id="famToggle" ${ui.group ? "checked" : ""} /> 🧩 Gom theo họ từ</label>
          <div class="seg seg-sm" id="accentSeg" title="Giọng đọc từ: bản ghi âm của từ điển Oxford">${[["gb", "🔊 Giọng Anh"], ["us", "Giọng Mỹ"]]
            .map(([k, l]) => `<button data-acc="${k}" aria-pressed="${ui.accent === k}">${l}</button>`).join("")}</div>
        </div>
        ${SE.geminiKey() && all.some((w) => w.dictSource !== "oxford") ? `<button class="btn ghost" id="oxfordAll">🔄 Lấy nghĩa Oxford cho các từ cũ</button>` : ""}
      </div>
      <div class="panel words-table-wrap"><div class="table-scroll"><table class="lib words-table" id="wordsList"></table></div></div>`;
    root.querySelector("#wordAdd").onsubmit = (e) => { e.preventDefault(); const v = e.target.w.value.trim(); if (v) { fromText(v); e.target.w.value = ""; } };
    // 📋 Dán: what was copied in another app. iPhone asks once with a small "Dán" bubble.
    root.querySelector("#wordPaste").onclick = async () => {
      let t = "";
      try { t = await navigator.clipboard.readText(); } catch { /* not allowed here */ }
      if (t.trim()) return fromText(t);
      root.querySelector("#wordAdd input").focus();
      toast("Chưa đọc được chữ đã chép. Giữ ngón tay vào ô “Thêm từ mới”, chọn Dán, rồi bấm Thêm.");
    };
    root.querySelector("#phoneHelp").onclick = openPhoneHelp;
    root.querySelector("#wordSearch").oninput = (e) => { ui.q = e.target.value; renderList(); };
    root.querySelector("#famToggle").onchange = (e) => { ui.group = e.target.checked; setPref("wordsGroup", ui.group ? "1" : "0"); renderList(); };
    root.querySelector("#accentSeg").onclick = (e) => {
      const b = e.target.closest("button[data-acc]");
      if (!b) return;
      ui.accent = b.dataset.acc;
      setPref("accent", ui.accent);
      root.querySelectorAll("#accentSeg button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      sayWord("pronunciation");
    };
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
    list().filter((w) => (!w.defEn || !w.lemmaChecked || (w.dictSource !== "oxford" && ((w.exV || 0) < 2 || !w.meaningVi))) && !tried.has(w.id)).slice(0, 10)
      .forEach((w) => { tried.add(w.id); lookup(w.id, { force: true }); });
  }
  const tried = new Set();

  const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const mark = (w, sentence) => highlight(sentence, w.form && !sentence.toLowerCase().includes(w.word.toLowerCase()) ? w.form : w.word);
  const highlight = (sentence, word) => {
    const i = sentence.toLowerCase().indexOf(word.toLowerCase());
    return i < 0 ? esc(sentence) : esc(sentence.slice(0, i)) + `<mark>${esc(sentence.slice(i, i + word.length))}</mark>` + esc(sentence.slice(i + word.length));
  };
  function stageBadge(w, todayIds) {
    if (known(w)) return `<span class="chip st-done">✓ Đã thuộc</span>`;
    if (todayIds.has(w.id)) return `<span class="chip st-due">Ôn hôm nay</span>`;
    if (w.stage === 0) return `<span class="chip st-new">Chờ học</span>`;
    if (isDue(w)) return `<span class="chip">Ôn ngày mai</span>`; // due, but today is already full (10 words)
    const tomorrow = today() + DAY;
    return `<span class="chip">Ôn ${startOfDay(w.due) === tomorrow ? "ngày mai" : dayLabel(w.due)}</span>`;
  }
  function renderList() {
    const todayIds = new Set(due().map((w) => w.id));
    const box = $("wordsList");
    if (!box) return;
    const q = ui.q.trim().toLowerCase();
    const items = list().filter((w) =>
      (!q || (w.word + " " + (w.meaningVi || "") + " " + (w.defEn || "")).toLowerCase().includes(q)) &&
      (ui.f === "all" || (ui.f === "due" && todayIds.has(w.id)) || (ui.f === "learning" && !known(w)) ||
       (ui.f === "mastered" && known(w)) || (ui.f === "video" && w.sourceKind === "video") ||
       (ui.f === "speaking" && !isReading(w)) || (ui.f === "reading" && isReading(w))));
    if (!items.length) {
      box.innerHTML = `<tbody><tr><td class="empty-row">${list().length ? "Không có từ nào ở đây. Thử bộ lọc khác." : "Từ vựng còn trống. Mở một video, bấm vào một từ trong phụ đề (hoặc gõ vào ô dưới video) rồi chọn ⭐ Lưu từ."}</td></tr></tbody>`;
      return;
    }
    // Families together: in the order the family first appears, members one after another.
    const fams = new Map();
    let rows = items;
    if (ui.group) {
      items.forEach((w) => { const k = famKey(w); fams.set(k, [...(fams.get(k) || []), w]); });
      rows = [...fams.values()].flat();
    }
    const famHead = (w, i) => {
      if (!ui.group) return "";
      const m = fams.get(famKey(w));
      if (m.length < 2 || m[0] !== w) return "";
      return `<tr class="fam-row"><td colspan="6"><span class="fam-ic" aria-hidden="true">🧩</span> <b>Họ từ</b>
        ${m.map((x) => `<span class="fam-w">${esc(x.word)}${x.pos ? ` <i>${esc(x.pos)}</i>` : ""}</span>`).join('<span class="fam-dot">·</span>')}
        <span class="muted small">· học cùng nhau, ôn cùng ngày</span></td></tr>`;
    };
    box.innerHTML = `<thead><tr><th>Từ</th><th>Dạng từ · Phiên âm</th><th>Nghe · Nói thử</th><th>Nghĩa (Oxford)</th><th>Nghĩa tiếng Việt</th><th>Câu ví dụ</th></tr></thead><tbody>` +
      rows.map((w, i) => famHead(w, i) + `<tr data-id="${w.id}"${ui.group && fams.get(famKey(w)).length > 1 ? ' class="in-fam"' : ""}>
        <td data-label="Từ"><b class="wc-word">${esc(w.word)}</b>${w.form && w.form.toLowerCase() !== w.word.toLowerCase() ? `<small class="wc-form" title="Dạng bạn đã gặp">từ “${esc(w.form)}”</small>` : ""}
          <div class="wc-meta">${stageBadge(w, todayIds)}<button type="button" class="use-chip ${isReading(w) ? "reading" : "speaking"}" data-a="use"
            title="Đổi sang ${isReading(w) ? "Speaking (ôn 6 lần)" : "Reading (ôn 3 lần)"}">${isReading(w) ? "📖 Reading" : "🗣 Speaking"}</button></div>
          ${w.sourceUrl ? `<a class="wc-src" href="${esc(w.sourceUrl)}" target="_blank" rel="noopener" title="${esc(w.sourceTitle || "")}">${w.sourceKind === "video" ? "▶ " + (w.time != null ? fmtT(w.time) : "video") : "↗ nguồn"}</a>` : ""}
          <span class="wc-row-acts"><button type="button" class="wc-edit" data-a="fam" title="Từ cùng họ" aria-label="Từ cùng họ">🧩</button><button type="button" class="wc-edit" data-a="edit" title="Sửa từ" aria-label="Sửa từ">✏️</button><button type="button" class="wc-del" data-a="del" title="Xóa từ" aria-label="Xóa từ">🗑</button></span></td>
        <td data-label="Dạng từ · Phiên âm">${w.pos ? `<span class="chip">${esc(w.pos)}</span>` : ""}<div class="wc-ipa">${esc(w.ipa || "")}</div></td>
        <td data-label="Nghe · Nói thử"><div class="wc-acts">
          <button type="button" class="btn small" data-a="say" title="Nghe từ">🔊 Nghe</button>
          <button type="button" class="btn small" data-a="speak" title="Nói thử và chấm điểm">🎙️ Nói thử</button></div>
          <div class="wc-score"></div></td>
        <td data-label="Nghĩa (Oxford)">${w.defEn ? `<div class="wc-def">${esc(w.defEn)}</div>` : `<span class="muted small">${tried.has(w.id) ? "Chưa tìm thấy" : "Đang tra…"}</span>`}
          <a class="wc-ox" href="${oxfordUrl(w.word)}" target="_blank" rel="noopener">${w.dictSource === "oxford" ? "Oxford ↗" : "Xem trên Oxford ↗"}</a></td>
        <td data-label="Nghĩa tiếng Việt">${w.meaningVi ? `<div class="wc-mean">${esc(w.meaningVi)}</div>` : `<a class="small" target="_blank" rel="noopener" href="https://translate.google.com/?sl=en&tl=vi&op=translate&text=${encodeURIComponent(w.word)}">🌐 Google Dịch</a>`}</td>
        <td data-label="Câu ví dụ"><ol class="wc-exs">${[...(w.context ? [{ t: w.context, mine: true }] : []), ...(w.examples || []).map((t, i) => ({ t, src: w.examplesSrc?.[i] || "" }))].slice(0, 3)
          .map((x, i) => `<li${x.mine ? ' class="mine" title="Câu bạn gặp từ này"' : ""}><button type="button" class="ex-say" data-a="ex" data-i="${i}" aria-label="Nghe câu">🔊</button> ${mark(w, x.t)}${x.src ? ` <span class="ex-src">${x.src}</span>` : ""}</li>`).join("") || '<li class="muted">Đang tìm câu ví dụ…</li>'}
          ${(w.myExamples || []).map((t, i) => `<li class="my-ex"><button type="button" class="ex-say" data-a="myex" data-i="${i}" aria-label="Nghe câu">🔊</button> ${mark(w, t)} <span class="ex-src mine-src">Của tôi</span><button type="button" class="ex-del" data-a="myexdel" data-i="${i}" title="Xóa câu này" aria-label="Xóa câu này">✕</button></li>`).join("")}</ol>
          <button type="button" class="linkish add-ex" data-a="addex">＋ Thêm ví dụ của bạn</button></td>
      </tr>`).join("") + "</tbody>";
    box.onclick = (e) => {
      if (e.target.closest(".fam-sug")) return famSugClick(e);
      const b = e.target.closest("[data-a]");
      if (!b) return;
      const row = b.closest("tr");
      const w = list().find((x) => x.id === row.dataset.id);
      if (!w) return;
      const exs = [...(w.context ? [w.context] : []), ...(w.examples || [])].slice(0, 3);
      if (b.dataset.a === "say") { sayWord(w.word); studied(w.id, "word"); }
      else if (b.dataset.a === "ex") { SE.say(exs[+b.dataset.i] || w.word); studied(w.id, "ex"); }
      else if (b.dataset.a === "myex") { SE.say(w.myExamples?.[+b.dataset.i] || w.word); studied(w.id, "ex"); }
      else if (b.dataset.a === "myexdel") update(w.id, { myExamples: (w.myExamples || []).filter((_, i) => i !== +b.dataset.i) });
      else if (b.dataset.a === "addex") addExample(b, w);
      else if (b.dataset.a === "speak") sayIt(w, b, row.querySelector(".wc-score"));
      else if (b.dataset.a === "edit") openEditor(row, w);
      else if (b.dataset.a === "fam") openFamily(row, w);
      else if (b.dataset.a === "use") setUse(w.id, isReading(w) ? "speaking" : "reading");
      else if (b.dataset.a === "del" && confirm(`Xóa “${w.word}” khỏi Từ vựng?`)) { saveList(list().filter((x) => x.id !== w.id)); render(); }
    };
  }
  // ---------- Text from the phone (paste, Share menu) ----------
  // One word or a short phrase ("take off") is saved straight away. A longer text opens the picker:
  // tap the words to keep (words next to each other become one phrase); the sentence is kept as the example.
  const WORD_RE = /([A-Za-z]+(?:['’-][A-Za-z]+)*)/;
  function fromText(text, src = {}) {
    const t = (text || "").replace(/\s+/g, " ").trim();
    const words = t.split(WORD_RE).filter((x, i) => i % 2);
    if (!words.length) return toast("Không thấy từ tiếng Anh nào để lưu.");
    if (words.length <= 3 && t.length <= 40 && /^[A-Za-z'’ -]+[.!?,;:]?$/.test(t)) return save({ word: t, ...src }).then((it) => { if (it) showWords(); return it; });
    openPicker(t.slice(0, 600), src);
  }
  function showWords() { if ($("view-words").hidden) SE.showView("words"); }
  function openPicker(text, src) {
    const dlg = $("pickDlg"), box = $("pickWords"), btn = $("pickSave");
    const parts = text.split(WORD_RE); // odd indices are words
    const sel = new Set();
    box.innerHTML = parts.map((x, i) => i % 2 ? `<button type="button" class="pick-w" data-i="${i}" aria-pressed="false">${esc(x)}</button>` : esc(x)).join("");
    // Selected words next to each other (only spaces between) form one phrase.
    const runs = () => {
      const out = [];
      [...sel].sort((a, b) => a - b).forEach((i) => {
        const last = out[out.length - 1];
        if (last && last.end === i - 2 && /^ +$/.test(parts[i - 1])) { last.text += " " + parts[i]; last.end = i; }
        else out.push({ text: parts[i], end: i });
      });
      return out.map((r) => r.text);
    };
    const refresh = () => {
      const r = runs();
      btn.disabled = !r.length;
      btn.textContent = r.length ? `⭐ Lưu: ${r.join(" · ")}` : "Chọn từ để lưu";
    };
    box.onclick = (e) => {
      const b = e.target.closest(".pick-w");
      if (!b) return;
      const i = +b.dataset.i;
      sel.has(i) ? sel.delete(i) : sel.add(i);
      b.setAttribute("aria-pressed", sel.has(i));
      refresh();
    };
    btn.onclick = async () => {
      const r = runs();
      dlg.close();
      for (const w of r) await save({ ...src, word: w, context: text });
      showWords();
    };
    refresh();
    dlg.showModal();
  }
  function openPhoneHelp() {
    const dlg = $("phoneDlg");
    const url = location.origin + location.pathname + "#share=";
    $("shareUrl").textContent = url;
    $("copyShareUrl").onclick = async () => {
      try { await navigator.clipboard.writeText(url); toast("Đã chép địa chỉ. Dán vào ô URL của tác vụ Mở URL."); }
      catch { toast("Chưa chép được. Giữ ngón tay lên địa chỉ để chép."); }
    };
    $("phoneSyncState").innerHTML = SE.safeGet("syncToken")
      ? "✓ Trình duyệt này đã bật đồng bộ: từ lưu ở đây sẽ tự sang các máy khác."
      : "⚠ Trình duyệt này <b>chưa</b> bật đồng bộ.";
    dlg.showModal();
  }

  // ＋ Thêm ví dụ của bạn: a sentence of your own, kept after the app's three (spoken by the AI voice too).
  function addExample(btn, w) {
    const f = document.createElement("form");
    f.className = "add-ex-form";
    f.innerHTML = `<input class="input" maxlength="300" placeholder="Câu của bạn với “${esc(w.word)}”…" aria-label="Câu ví dụ của bạn" />
      <button class="btn small primary">Lưu</button><button type="button" class="btn small ghost" data-cancel>Huỷ</button>`;
    btn.replaceWith(f);
    const inp = f.querySelector("input");
    inp.focus();
    f.onsubmit = (e) => {
      e.preventDefault();
      let t = inp.value.replace(/\s+/g, " ").trim();
      if (!t) return renderList();
      t = t[0].toUpperCase() + t.slice(1);
      if (!/[.!?]$/.test(t)) t += ".";
      update(w.id, { myExamples: [...(w.myExamples || []), t] });
    };
    f.querySelector("[data-cancel]").onclick = () => renderList();
    inp.onkeydown = (e) => { if (e.key === "Escape") renderList(); };
  }
  // Cambridge/Oxford examples found by GitHub (tools/voice/make_examples.py → examples.json): they go first,
  // the earlier examples fill up to three. exV 3 = done (also when the dictionaries had none).
  function applyDictExamples(map) {
    let changed = false;
    const out = list().map((w) => {
      const e = (w.exV || 0) < 3 && map[w.word.toLowerCase()];
      if (!e) return w;
      changed = true;
      const ex = [...(e.ex || [])], src = [...(e.src || [])];
      const seen = new Set(ex.map((x) => x.toLowerCase()));
      (w.examples || []).forEach((x, i) => { if (ex.length < 3 && !seen.has(x.toLowerCase())) { ex.push(x); src.push(w.examplesSrc?.[i] || ""); } });
      return { ...w, examples: ex, examplesSrc: src, exV: 3 };
    });
    if (!changed) return;
    saveList(out);
    if (!$("view-words").hidden && !ui.review) renderList();
  }

  // 🧩: the word's family. Saved members ✓, other common members with ＋ to save them into this family,
  // and "Tách khỏi họ" when the automatic match is wrong.
  async function openFamily(row, w) {
    const open = row.nextElementSibling?.classList.contains("fam-sug") ? row.nextElementSibling : null;
    if (open) { open.remove(); return; }
    document.querySelectorAll("#wordsList .fam-sug").forEach((x) => x.remove());
    const tr = document.createElement("tr");
    tr.className = "fam-sug";
    tr.dataset.for = w.id;
    tr.innerHTML = `<td colspan="6"><span class="muted small">🧩 Đang tìm các từ cùng họ với “${esc(w.word)}”…</span></td>`;
    row.after(tr);
    const all = list();
    const mates = siblings(w, all);
    const have = new Set(all.map((x) => x.word.toLowerCase()));
    const sug = (await suggestFamily(w)).filter((x) => x.word !== w.word.toLowerCase());
    if (!tr.isConnected) return;
    const chips = [
      ...mates.map((x) => `<span class="fam-chip have">✓ ${esc(x.word)}${x.pos ? ` <i>${esc(x.pos)}</i>` : ""}</span>`),
      ...sug.filter((x) => !mates.some((m) => m.word.toLowerCase() === x.word)).map((x) => have.has(x.word)
        ? `<span class="fam-chip have" title="Đã lưu, ở họ khác">✓ ${esc(x.word)}</span>`
        : `<button type="button" class="fam-chip add" data-add="${esc(x.word)}" title="Lưu, cùng họ với ${esc(w.word)}">＋ ${esc(x.word)}${x.pos.length ? ` <i>${x.pos.map((p) => POS_VI[p]).join(", ")}</i>` : ""}</button>`),
    ];
    tr.innerHTML = `<td colspan="6"><div class="fam-box"><b>🧩 Họ từ của “${esc(w.word)}”</b>
      <div class="fam-chips">${chips.join("") || `<span class="muted small">Chưa tìm thấy từ cùng họ thông dụng.</span>`}</div>
      <div class="fam-foot">${mates.length ? `<button type="button" class="btn small ghost" data-split>Tách “${esc(w.word)}” khỏi họ này</button>` : ""}
        ${w.familyKey === w.word.toLowerCase() ? `<button type="button" class="btn small ghost" data-join>Gom lại theo họ tự động</button>` : ""}
        <span class="muted small">Bấm ＋ để lưu từ đó; các từ cùng họ được học và ôn cùng ngày.</span></div></div></td>`;
  }
  async function famSugClick(e) {
    const tr = e.target.closest(".fam-sug");
    const w = list().find((x) => x.id === tr.dataset.for);
    if (!w) return;
    const add = e.target.closest("[data-add]");
    if (add) {
      add.disabled = true;
      await save({ word: add.dataset.add, familyKey: famKey(w) });
    } else if (e.target.closest("[data-split]")) {
      update(w.id, { familyKey: w.word.toLowerCase() });
      toast(`Đã tách “${w.word}” khỏi họ từ`);
    } else if (e.target.closest("[data-join]")) {
      update(w.id, { familyKey: null });
    }
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
  // Studying a word in the list counts as today's review (if it is due today, or new): hearing the word and
  // one of its examples, or saying it well (Nói thử ≥ 70%).
  const heard = new Map(); // word id → { word, ex }
  function studied(id, what) {
    const h = heard.get(id) || {};
    h[what] = true;
    heard.set(id, h);
    if (what === "speak" || (h.word && h.ex)) creditReview(id);
  }
  function creditReview(id) {
    const w = list().find((x) => x.id === id);
    if (!w || reviewedToday(w) || known(w) || !(isDue(w) || w.stage === 0)) return;
    const patch = advance(w, true);
    update(w.id, patch);
    const days = patch.due ? Math.round((patch.due - today()) / DAY) : 0;
    toast(`✓ Đã tính là đã ôn “${w.word}”${patch.due ? ` · ôn lại sau ${days} ngày` : " · đã thuộc"}`);
    if (!$("view-words").hidden && !ui.review) renderReview();
    updateNav();
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
    if (r.score >= 70) studied(w.id, "speak");
    out.innerHTML = `<span class="badge ${r.score >= 80 ? "good" : r.score >= 60 ? "ok" : "low"}">${r.score}%</span> <span class="muted small">${esc(res.text)}</span>`;
  }

  // Speaking ↔ Reading. A word past the new list's last step is learned; one that was learned as Reading and
  // becomes Speaking goes on with its reviews (in 2 days).
  function setUse(id, use) {
    const w = list().find((x) => x.id === id);
    if (!w || (w.use || "speaking") === use) return;
    const next = { ...w, use };
    const patch = { use };
    if (known(next)) patch.due = null;
    else if (next.stage >= 1 && next.due == null) patch.due = pickDay(1, id, gaps(next));
    update(id, patch);
    toast(use === "reading" ? `📖 “${w.word}”: từ để đọc, ôn 3 lần` : `🗣 “${w.word}”: từ để nói, ôn 6 lần`);
    updateNav();
  }

  // ---------- Daily review (flashcards) ----------
  // "Tiếp theo: ngày mai · 2 từ" (or the first day with words to review).
  function nextReview() {
    const all = list();
    const tomorrow = today() + DAY;
    const waiting = all.filter((w) => w.stage === 0).length - due().filter((w) => w.stage === 0).length;
    const more = waiting > 0 ? ` · còn ${waiting} từ mới chờ học` : "";
    const upcoming = all.filter((w) => w.stage >= 1 && !known(w) && w.due != null && startOfDay(w.due) >= tomorrow);
    if (!upcoming.length) return (all.length ? "Chưa có từ hẹn ôn." : "Lưu từ mới để bắt đầu.") + more;
    const day = Math.min(...upcoming.map((w) => startOfDay(w.due)));
    const n = upcoming.filter((w) => startOfDay(w.due) === day).length;
    return `Tiếp theo: ${day === tomorrow ? "ngày mai" : dayLabel(day)} · ${n} từ ôn lại${more}`;
  }
  // What "Nhớ rồi" does to this word, in words: "ôn lại sau 3 ngày", "… 1 tuần", "đã thuộc".
  const GAP_NAMES = { 2: "2 ngày", 4: "4 ngày", 7: "1 tuần", 14: "2 tuần", 30: "1 tháng" };
  function nextGap(w, failedToday) {
    const stage = failedToday ? 1 : Math.min(w.stage + 1, doneAt(w));
    return stage >= doneAt(w) ? "xong, đã thuộc" : `ôn lại sau ${GAP_NAMES[gaps(w)[stage - 1]]}`;
  }
  function renderReview() {
    const box = $("reviewBox");
    if (!box) return;
    const d = due();
    if (!ui.review) {
      // One line: what to do today and when the next review is. The schedule rule sits behind ⓘ.
      box.innerHTML = `<div class="review-bar">
        <span class="rv-ic" aria-hidden="true">${d.length ? "🃏" : "✓"}</span>
        <div class="rv-text"><b>${d.length ? `Hôm nay ôn ${d.length} từ` : list().some(reviewedToday) ? `Hôm nay đã ôn xong (${list().filter(reviewedToday).length} từ)` : list().length ? "Hôm nay không có từ cần ôn" : "Chưa có từ để ôn"}</b>
          ${d.length ? `<span class="muted small">(${d.filter((w) => w.stage >= 1).length} ôn lại · ${d.filter((w) => w.stage === 0).length} từ mới)</span>` : ""}
          <span class="muted small">${nextReview()}</span>
          <span class="rv-info" tabindex="0" title="Mỗi ngày tối đa 10 từ: từ đến hạn ôn trước, rồi đến từ mới. Mỗi từ được ôn lại sau 2 ngày, 4 ngày, 1 tuần, 2 tuần và 1 tháng kể từ lần ôn trước (có thể xê dịch 1–3 ngày khi ngày đó đã gần đủ 10 từ). Ôn đủ 5 lần là đã thuộc. Từ đã học hôm nay không bao giờ quay lại vào ngày mai. Trên thẻ ôn, bấm 🗣 Speaking (từ để nói, ôn 6 lần) hoặc 📖 Reading (từ để đọc, ôn 3 lần, lịch 4 ngày rồi 2 tuần). Mỗi ngày luôn có ít nhất 3 từ mới. Nghe từ và một câu ví dụ, hoặc Nói thử đạt 70%, trong bảng bên dưới cũng được tính là đã ôn." aria-label="Lịch ôn: tối đa 10 từ mỗi ngày; ôn lại sau 2, 4, 7, 14 và 30 ngày">ⓘ</span></div>
        <div class="toolbar">${d.length ? `<button class="btn primary" data-start>Bắt đầu ôn</button>` : todayQueue(list(), 5).length ? `<button class="btn" data-more>＋ Học thêm 5 từ</button>` : ""}
          ${list().length ? `<button class="btn" data-voice>🎙️ Ôn bằng giọng nói</button>` : ""}</div>
      </div>`;
      // Voice review in ChatGPT / Gemini: today's words, or the 12 newest if none are due.
      box.querySelector("[data-voice]")?.addEventListener("click", () => {
        const words = (d.length ? d : list()).slice(0, 12);
        window.SE_HANDOFF.open({ title: `Ôn ${words.length} từ`, prompt: window.SE_HANDOFF.wordsPrompt(words) });
      });
      box.querySelector("[data-start]")?.addEventListener("click", () => {
        ui.review = { queue: d.map((w) => w.id), shown: false, done: 0, again: new Set() };
        renderReview();
      });
      box.querySelector("[data-more]")?.addEventListener("click", () => {
        ui.review = { queue: todayQueue(list(), 5).map((w) => w.id), shown: false, done: 0, again: new Set() };
        renderReview();
      });
      return;
    }
    const R = ui.review;
    const w = list().find((x) => x.id === R.queue[0]);
    // ◀ Back undoes the last step (answer, skip or "Thuộc rồi"): the word's schedule and the round as they were.
    const back = () => {
      const h = R.history?.pop();
      if (!h) return;
      if (h.before) update(h.id, h.before);
      R.queue = h.queue;
      R.again = new Set(h.again);
      R.done = h.done;
      renderReview();
      updateNav();
    };
    if (!w) {
      box.innerHTML = `<div class="panel-body review-start"><div><b>🎉 Xong! Đã ôn ${R.done} từ hôm nay.</b></div>
        <div class="toolbar">${R.history?.length ? `<button class="btn ghost" data-back>◀ Trước</button>` : ""}<button class="btn" data-end>Đóng</button></div></div>`;
      box.querySelector("[data-end]").onclick = () => { ui.review = null; render(); };
      box.querySelector("[data-back]")?.addEventListener("click", back);
      return;
    }
    const exs = [...[...(w.context ? [w.context] : []), ...(w.examples || [])].slice(0, 3), ...(w.myExamples || [])];
    // The card shows everything at once (word, meaning, examples). A new card ignores taps for a moment, so a
    // quick second tap on the previous card's answer doesn't answer this one too.
    if (R.cardId !== w.id) { R.cardId = w.id; R.shownAt = Date.now(); }
    box.innerHTML = `<div class="panel-body flash">
      <div class="muted small">Còn ${R.queue.length} từ · lần ${Math.min(w.stage + 1, doneAt(w))}/${doneAt(w)}</div>
      <div class="flash-word">${esc(w.word)} <button type="button" class="btn small" data-say>🔊</button></div>
      <div class="muted">${esc([w.pos, w.ipa].filter(Boolean).join(" · "))}</div>
          ${w.meaningVi ? `<div class="wc-mean">${esc(w.meaningVi)}</div>` : ""}${w.defEn ? `<div class="wc-def">${esc(w.defEn)}</div>` : ""}
          ${exs.length ? `<ol class="wc-exs">${exs.map((s, i) => `<li><button type="button" class="ex-say" data-fex="${i}" aria-label="Nghe câu">🔊</button> ${mark(w, s)}</li>`).join("")}</ol>` : ""}
          ${siblings(w).length ? `<div class="flash-fam">🧩 Cùng họ: ${siblings(w).map((x) => `<b>${esc(x.word)}</b>${x.pos ? ` <i>${esc(x.pos)}</i>` : ""}${x.meaningVi ? ` – ${esc(x.meaningVi.split(/[;,]/)[0])}` : ""}`).join(" · ")}</div>` : ""}
          <div class="flash-bottom">
            <button type="button" class="btn nav-btn" data-back ${R.history?.length ? "" : "disabled"} title="Quay lại từ trước (huỷ câu trả lời của từ đó)">◀ Back</button>
            <div class="toolbar flash-acts" role="group" aria-label="Từ này để nói hay để đọc">
              <button class="btn answer${isReading(w) ? "" : " primary"}" data-ans="speaking" title="Từ để nói: ôn 6 lần">🗣 Speaking<small>${nextGap({ ...w, use: "speaking" })}</small></button>
              <button class="btn answer${isReading(w) ? " primary" : ""}" data-ans="reading" title="Từ để đọc hiểu: ôn 3 lần">📖 Reading<small>${nextGap({ ...w, use: "reading" })}</small></button></div>
            <button type="button" class="btn nav-btn" data-next title="Bỏ qua từ này lần này, không chấm (vẫn ôn vào lần sau)">Next ▶</button>
          </div>
          <button type="button" class="linkish flash-known" data-known>✓ Thuộc rồi, không cần ôn nữa</button>
    </div>`;
    box.querySelector("[data-say]").onclick = () => sayWord(w.word);
    box.querySelectorAll("[data-fex]").forEach((b) => { b.onclick = () => SE.say(exs[+b.dataset.fex]); });
    // Every step is kept (word schedule + round) so ◀ Trước can undo it.
    const step = (fn) => {
      R.history = [...(R.history || []), { id: w.id, queue: [...R.queue], again: [...R.again], done: R.done,
        before: { stage: w.stage, learnedAt: w.learnedAt ?? null, lastReview: w.lastReview ?? null, due: w.due ?? null, use: w.use ?? null } }];
      fn();
      renderReview();
      updateNav();
    };
    // 🗣 Speaking / 📖 Reading: the answer. The word goes to that list and on to its next step there
    // (Speaking: 6 times in all, Reading: 3), so the button says when it comes back.
    const answer = (use) => {
      if (Date.now() - (R.shownAt || 0) < 400) return; // a second tap meant for the previous card
      step(() => {
        update(w.id, { use, ...advance({ ...w, use }, true) });
        R.queue.shift();
        R.done += 1;
        SE.track("review");
      });
    };
    box.querySelectorAll("[data-ans]").forEach((b) => { b.onclick = () => answer(b.dataset.ans); });
    // Tiếp ▶: skip this word in this round, without an answer (it stays due).
    box.querySelector("[data-next]").onclick = () => step(() => { R.queue.shift(); });
    // ✓ Thuộc rồi: known for good, no more reviews (shown as "Đã thuộc" in the list).
    box.querySelector("[data-known]").onclick = () => step(() => {
      update(w.id, { stage: doneAt(w), learnedAt: w.learnedAt || Date.now(), lastReview: Date.now(), due: null });
      R.queue.shift();
      R.done += 1;
    });
    box.querySelector("[data-back]").onclick = back;

  }

  function updateNav() {
    const n = list().length, d = due().length;
    $("navWords").textContent = n ? `${n} từ${d ? ` · ${d} cần ôn hôm nay` : ""}` : "Lưu từ mới để ôn";
  }

  document.addEventListener("se:view", (e) => {
    closePop();
    if (e.detail !== "words") return;
    ui.review = null;
    SE.startSession({ id: "words", title: "Từ vựng", titleVi: "Từ vựng" }, "words");
    render();
  });
  document.addEventListener("se:synced", () => { updateNav(); if (!$("view-words").hidden && !ui.review) render(); });

  window.SE_WORDS = { save, popover, sayWord, fromText, tapWord, applyDictExamples };
  updateNav();
})();
