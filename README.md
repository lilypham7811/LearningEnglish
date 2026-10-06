# Shadow English

Type a topic, get a conversation, listen to it, and shadow any sentence. No API keys and no backend.

## Run

Serve the folder with any static server (the microphone needs `http://localhost`, not `file://`):

```
python -m http.server 8000
```

Then open http://localhost:8000 in **Chrome or Edge**.

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

Copy one object in `dialogs.js`, give it new `keywords`, `speakers` and `lines`.

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
