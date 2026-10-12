# Shadow English

Everyday English speaking practice for Vietnamese learners, designed for phones. Type a topic (in English or Vietnamese), get a conversation, listen, shadow any sentence, then role-play it. No API keys and no backend.

## Learning features

- **Shadowing panel** (tap a sentence): 🔊 listen, 🐢 slow, 🧩 *chunks* (back-chaining: practise the end of the sentence first and add one thought group at a time), 🔁 shadow ×3, 🎙️ record and score with word-by-word feedback and tips for common Vietnamese pronunciation problems (final consonants, -s/-ed endings, "th").
- **🎭 Role-play**: choose a character; the app speaks the other part and listens to yours. Three rounds with less help each time: full sentence → first letters (`D_ y__ h___…`) → Vietnamese meaning only.
- **Vietnamese support**: Vietnamese UI, translations for every library line (🇻🇳 toggle), Vietnamese topic search (`gọi cà phê`, `hỏi đường`), Google Translate links for AI dialogs.

## Run

Serve the folder with any static server (the microphone needs `http://localhost`, not `file://`):

```
python -m http.server 8000
```

Then open http://localhost:8000 in **Chrome or Edge**.

## Google AI (free, optional)

Paste a free Gemini API key (from https://aistudio.google.com/apikey) in **Cài đặt**. It is stored only in this browser.

- **🎙️ Luyện với Google AI**: live voice practice (`live.js`, Gemini Live API, model `gemini-3.8-live`). The AI plays the other role, follows the dialog, corrects mistakes, or chats freely about the topic.
- **✨ Tạo hội thoại**: new topics are written by `gemini-3.8-flash`, with Vietnamese translations, and saved automatically under **⭐ Của tôi**.

On the free tier Google may use the content to improve its products.

## Sections 3–5 (`library.js`)

- **Video tin tức**: saved YouTube news videos (embedded player, link to YouTube). Google AI watches the video once and writes the transcript; then the chat can pick the 3 best phrases, new words, a summary, or start a live voice chat about it.
- **Bài báo**: saved news articles with a reading view (click a sentence to hear it). Google AI picks 3–5 sentences/phrases to practise (listen + say it and get a score), new words, a summary.
- **Phát biểu**: paste a speech or have Google AI write one; teleprompter, model reading, record yourself and get AI feedback on the recording (score, pronunciation, pace, pauses, filler words), audience Q&A by voice. Practice counts and a daily streak.

### Browser extension (`extension/`)

Right-click a page → **Save to LearningEnglish** (or the toolbar button, or Alt+Shift+S). YouTube pages go to Videos; other pages go to Articles with their text. Install: `chrome://extensions` → Developer mode → Load unpacked → choose the `extension` folder. The app must be served at http://localhost:8000.

## Practice tracking

**Tiến độ luyện tập** logs each practice session (date, time, topic, activities, active time, best score) in localStorage and shows totals, a 12-week calendar, top topics and a log table.

## How it works without an API

| Feature | Browser technology |
|---|---|
| Common topics | Built-in hand-written library (`dialogs.js`), opens instantly |
| Any other topic (default) | [WebLLM](https://github.com/mlc-ai/web-llm) runs a free open model (Llama 3.2 1B) inside the browser via WebGPU. No API key, no cost. Downloads once (~900 MB), then cached |
| No WebGPU | Falls back to the closest library dialog or a simple template |
| Listening | `speechSynthesis` (voices from your OS/browser) |
| Recording | `MediaRecorder` |
| Pronunciation check | `SpeechRecognition` + word-by-word comparison |

## Adding topics

Copy one object in `dialogs.js` and give it new `keywords` (English), `viKeywords` (Vietnamese without accents), `speakers` and `lines` (`[speaker, English, Vietnamese]`).

## Keyboard shortcuts (shadow panel open)

`Space` listen · `R` record · `←/→` previous/next line · `Esc` close

## Saving dialogs

Press **☆ Save** on any dialog. Saved dialogs appear under **⭐ My saved dialogs** on the home screen and are stored in this browser (localStorage), so they stay after closing the page. Use **Export** to download a backup `.json` file and **Import** to load it on another computer or browser.

## AI dialog quality

- **Level** (Beginner / Intermediate / Advanced) sets vocabulary, grammar and max sentence length in the prompt.
- **Automatic checks** run on every AI dialog: length, both speakers take turns, no repeated lines or phrases, sentence length for the level, English only, no bad words. A failed dialog is regenerated (up to 3 attempts) and the best one is kept.
- **Model** (⚙️ settings): *Fast* = Llama 3.2 1B (~900 MB). *Better* = Llama 3.2 3B (~2.3 GB), noticeably more logical and natural.
- **Human control**: 🔄 New version asks for a different dialog; ✏️ Edit lets you fix any sentence (edits are kept if the dialog is saved).
- Automatic checks catch structural problems, not meaning. For dialogs you sell or publish, review them and add the good ones to `dialogs.js`.
