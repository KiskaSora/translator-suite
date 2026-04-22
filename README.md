# Translator Buttons — SillyTavern Extension

Adds a small 🌐 button in the corner of every character card and lorebook textarea.  
Click it → a translation popup appears. Accept the result to replace the original text.

---

## Installation

1. Extract this folder (`translator-buttons`) into:
   ```
   SillyTavern/public/extensions/translator-buttons/
   ```
2. Open SillyTavern, go to **Extensions** (puzzle icon) → **Manage Extensions**.
3. Enable **Translator Buttons**.
4. Reload the page if prompted.

---

## Where buttons appear

- Character card: Description, Personality, Scenario, First Message, Creator Notes, System Prompt
- World Info / Lorebook: every entry content textarea

---

## Providers

### LibreTranslate (free / self-hosted)
- Default URL: `https://libretranslate.com` (may need an API key)
- Or self-host: https://github.com/LibreTranslate/LibreTranslate

### DeepL API
- Requires a DeepL account and API key
- Tick **Free tier** if using the free plan

### Custom AI API (OpenAI-compatible)
Works with any proxy or server that speaks the `/v1/chat/completions` format:
- OpenAI, Anthropic (via proxy), Mistral, local Ollama, SillyTavern Extras, etc.
- Enter the server URL (no trailing slash), your API key, and a model name.
- Use **⟳ Load list** to auto-fetch available models from `/v1/models`.
- The pre-filled system prompt instructs the AI to translate faithfully while  
  preserving all SillyTavern-specific tags (`{{char}}`, `{{user}}`, `[bgm]…`, etc.).

---

## Usage

1. Open a character card or World Info entry.
2. Hover over any textarea — a small 🌐 button appears in the bottom-right corner.
3. Click it.
4. Choose source & target languages in the **Translate** tab.
5. Click **Translate**.
6. Review and optionally edit the result.
7. Click **✓ Accept & Replace** to overwrite the original field.

---

## Keyboard shortcut

`Esc` — close the translation popup without changes.
