/**
 * Translator Buttons — SillyTavern Extension
 * Adds inline translate buttons to character card & lorebook textareas.
 * Supports Google Translate (free), LibreTranslate, DeepL, and Custom AI API.
 *
 * v2.0 — Fixed button injection: uses fixed-position overlay instead of
 *         DOM wrapping to avoid breaking SillyTavern's layout.
 */

(function () {
    'use strict';

    const EXT = 'TranslatorButtons';
    const STORAGE_KEY = 'translator_buttons_v2';

    // Базовый путь к CSS-файлам тем (относительно папки расширения)
    function extBase() {
        try {
            const s = document.querySelector('script[src*="translator-buttons"][src$="index.js"]');
            if (s) return s.src.replace(/index\.js.*$/, '');
            const l = document.querySelector('link[href*="translator-buttons"][href*="style.css"]');
            if (l) return l.href.replace(/style\.css.*$/, '');
        } catch {}
        return '';
    }

    const THEMES = [
        { id: 'default',    label: 'Default (mono grey)', file: '' },
        { id: 'mono-gray',  label: 'Mono Gray (burgundy)', file: 'themes/theme-mono-gray.css' },
        { id: 'mono-glass', label: 'Mono Glass (glassmorphism)', file: 'themes/theme-mono-glass.css' },
    ];


    const DEFAULTS = {
        provider: 'google',
        sourceLang: 'auto',
        targetLang: 'ru',
        theme: 'default',
        themeSideImg: '',
        libre: { url: 'https://libretranslate.com', apiKey: '' },
        deepl: { apiKey: '', freeApi: true },
        custom: {
            url: '', apiKey: '', model: '',
            systemPrompt:
`You are a professional translation engine. Your ONLY job is to translate text.

STRICT RULES — never break these:
• Translate the ENTIRE text without skipping, shortening, or summarising anything.
• Preserve ALL special tags, markup and formatting EXACTLY as-is:
  {{char}}, {{user}}, <tags>, [tags], *asterisks*, _underscores_, #headings, etc.
• Keep every character name, proper noun and technical term unchanged unless
  there is a widely accepted equivalent in the target language.
• DO NOT add notes, explanations, translator comments, or disclaimers.
• DO NOT wrap the output in quotation marks or code blocks.
• Output ONLY the translated text — nothing before, nothing after.`
        }
    };

    const LANGS = [
        { code: 'auto', label: '🔍 Auto-detect' },
        { code: 'en',   label: '🇬🇧 English'    },
        { code: 'ru',   label: '🇷🇺 Russian'    },
        { code: 'uk',   label: '🇺🇦 Ukrainian'  },
        { code: 'de',   label: '🇩🇪 German'     },
        { code: 'fr',   label: '🇫🇷 French'     },
        { code: 'es',   label: '🇪🇸 Spanish'    },
        { code: 'it',   label: '🇮🇹 Italian'    },
        { code: 'pt',   label: '🇵🇹 Portuguese' },
        { code: 'pl',   label: '🇵🇱 Polish'     },
        { code: 'nl',   label: '🇳🇱 Dutch'      },
        { code: 'sv',   label: '🇸🇪 Swedish'    },
        { code: 'tr',   label: '🇹🇷 Turkish'    },
        { code: 'ja',   label: '🇯🇵 Japanese'   },
        { code: 'zh',   label: '🇨🇳 Chinese'    },
        { code: 'ko',   label: '🇰🇷 Korean'     },
        { code: 'ar',   label: '🇸🇦 Arabic'     },
    ];

    const SELECTORS = [
        // ── Core character card fields ─────────────────
        '#description',
        '#personality',
        '#scenario',
        '#mes_example',
        '#char_greeting',
        '#creator_notes',
        '#system_prompt',
        '#chat_background',
        '#char_note_text',      // character note (extended popup)
        '#char_note',           // alt id for character note

        // ── Persona management ─────────────────────────
        '#persona_description',
        '#persona_description_block textarea',
        '#personas-block textarea',
        '#persona_block textarea',

        // ── Alternate / extra greetings ────────────────
        '.alternate_greeting',
        '.alternate_greeting_block textarea',
        '[id^="alternate_greeting"]',
        '.extra_greeting textarea',

        // ── Extended character settings popup ──────────
        '#advanced_character_settings textarea',
        '#character_cross_api_popup textarea',
        '#character_popup textarea',
        '.character_popup_desc_block textarea',
        '.extra_settings_block textarea',
        '.popup-content textarea',

        // ── Character editor / creation form ──────────
        '#form_create textarea',
        '#rm_ch_create_block textarea',
        '.character_editor_main textarea',
        '#char_form textarea',

        // ── World Info / Lorebook ──────────────────────
        '.world_entry_text',
        '.world_entry textarea',
        '.world_entry_form textarea',
        '#worldinfo-search-results textarea',
        '#WorldInfo textarea',
        '.world_info_block textarea',

        // ── Broad fallback — any textarea in ST panels ─
        // (safe because fixed-position buttons don't touch the DOM)
        '.drawer-content textarea',
        '.inline-drawer-content textarea',
        '#sheld textarea',
        '#right-nav-panel textarea',
    ];

    let cfg = deepClone(DEFAULTS);
    let activeTA = null;

    function loadCfg() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) cfg = deepMerge(DEFAULTS, JSON.parse(raw));
        } catch (e) { console.warn(`[${EXT}] load settings failed`, e); }
    }

    /* ── THEMES ── */
    function applyTheme() {
        // Подгружаем CSS темы при необходимости
        const theme = THEMES.find(t => t.id === cfg.theme) || THEMES[0];
        const linkId = 'tb-theme-css';
        let link = document.getElementById(linkId);
        if (theme.file) {
            const href = extBase() + theme.file;
            if (!link) {
                link = document.createElement('link');
                link.id = linkId;
                link.rel = 'stylesheet';
                document.head.appendChild(link);
            }
            if (link.getAttribute('href') !== href) link.href = href;
        } else if (link) {
            link.remove();
        }

        // Применяем класс темы и переменную картинки к модалке
        const m = document.getElementById('translator-modal');
        if (m) {
            THEMES.forEach(t => m.classList.remove('tb-theme-' + t.id));
            if (theme.id !== 'default') m.classList.add('tb-theme-' + theme.id);
            if (cfg.themeSideImg && cfg.themeSideImg.trim()) {
                m.style.setProperty('--tb-side-img', `url("${cfg.themeSideImg.trim()}")`);
            } else {
                m.style.removeProperty('--tb-side-img');
            }
        }
    }
    function saveCfg() { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); }
    function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
    function deepMerge(base, patch) {
        const r = { ...base };
        for (const k of Object.keys(patch)) {
            if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]))
                r[k] = deepMerge(base[k] || {}, patch[k]);
            else r[k] = patch[k];
        }
        return r;
    }
    function esc(s) { const d = document.createElement('div'); d.appendChild(document.createTextNode(s)); return d.innerHTML; }
    function langName(code) { const l = LANGS.find(x => x.code === code); return l ? l.label.replace(/^\S+\s/, '') : code; }
    function langOpts(excludeAuto = false) {
        return LANGS.filter(l => !excludeAuto || l.code !== 'auto')
            .map(l => `<option value="${l.code}">${l.label}</option>`).join('');
    }

    /* ── BUTTON INJECTION — fixed-position, NO DOM wrapping ── */

    const SVG_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8l6 6"/><path d="M4 14l6-6 2-2"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/></svg>`;

    function injectBtn(ta) {
        if (!ta || ta.dataset.tbInjected || ta.closest('#translator-modal')) return;

        const id = 'tbi-' + Math.random().toString(36).slice(2, 9);
        ta.dataset.tbInjected = id;

        const btn = document.createElement('button');
        btn.className = 'tb-btn';
        btn.title = 'Translate';
        btn.setAttribute('aria-label', 'Open translator');
        btn.setAttribute('data-tb-for', id);
        btn.innerHTML = SVG_ICON;
        document.body.appendChild(btn);

        let leaveTimer = null;

        function place() {
            const r = ta.getBoundingClientRect();
            if (r.width < 10 || r.height < 10) { btn.classList.remove('tb-visible'); return; }
            btn.style.left = Math.round(r.right - 30) + 'px';
            btn.style.top  = Math.round(r.bottom - 30) + 'px';
        }

        function show() {
            clearTimeout(leaveTimer);
            if (!document.contains(ta)) { btn.remove(); return; }
            place();
            btn.classList.add('tb-visible');
        }

        function hide(delay) {
            leaveTimer = setTimeout(() => btn.classList.remove('tb-visible'), delay || 120);
        }

        ta.addEventListener('mouseenter', show);
        ta.addEventListener('mousemove',  place);
        ta.addEventListener('mouseleave', e => { if (e.relatedTarget !== btn) hide(); });
        ta.addEventListener('focus',      show);
        ta.addEventListener('blur',       () => hide(300));

        btn.addEventListener('mouseenter', () => clearTimeout(leaveTimer));
        btn.addEventListener('mouseleave', () => hide());

        btn.addEventListener('click', e => {
            e.preventDefault(); e.stopPropagation();
            activeTA = ta;
            btn.classList.remove('tb-visible');
            openModal(ta.value);
        });
    }

    function scanAndInject() {
        SELECTORS.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                if (el.tagName === 'TEXTAREA') injectBtn(el);
            });
        });
        // Clean up buttons whose textareas are gone
        document.querySelectorAll('.tb-btn[data-tb-for]').forEach(btn => {
            if (!document.querySelector(`[data-tb-injected="${btn.dataset.tbFor}"]`))
                btn.remove();
        });
    }

    /* ── MODAL HTML ── */
    function buildModal() {
        if (document.getElementById('translator-modal')) return;
        const m = document.createElement('div');
        m.id = 'translator-modal';
        m.innerHTML = `
<div class="tb-backdrop"></div>
<div class="tb-dialog" role="dialog" aria-modal="true" aria-label="Translator">
  <div class="tb-header">
    <span class="tb-title">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      Translator
    </span>
    <nav class="tb-tabs">
      <button class="tb-tab tb-tab-active" data-tab="translate">Translate</button>
      <button class="tb-tab" data-tab="settings">⚙ Settings</button>
    </nav>
    <button class="tb-close" title="Close">✕</button>
  </div>

  <div class="tb-panel tb-panel-active" id="tb-translate">
    <div class="tb-lang-bar">
      <div class="tb-lang-group"><label>From</label><select id="tb-src-lang">${langOpts()}</select></div>
      <button class="tb-swap" title="Swap languages">⇄</button>
      <div class="tb-lang-group"><label>To</label><select id="tb-tgt-lang">${langOpts(true)}</select></div>
    </div>
    <div class="tb-texts">
      <div class="tb-col">
        <label>Original</label>
        <textarea id="tb-orig" readonly placeholder="Open a character / lorebook textarea and click the translate button…"></textarea>
      </div>
      <div class="tb-col">
        <label>Translation <span class="tb-badge" id="tb-badge"></span></label>
        <textarea id="tb-result" placeholder="Translation will appear here…"></textarea>
      </div>
    </div>
    <div class="tb-actions">
      <button class="tb-btn-action tb-primary" id="tb-do-translate">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        Translate
      </button>
      <button class="tb-btn-action tb-success" id="tb-accept" disabled>✓ Accept & Replace</button>
      <button class="tb-btn-action tb-secondary" id="tb-discard">✕ Cancel</button>
    </div>
    <div class="tb-status" id="tb-status"></div>
  </div>

  <div class="tb-panel" id="tb-settings">
    <div class="tb-set-section">
      <div class="tb-set-label">Theme</div>
      <div class="tb-field">
        <select id="tb-theme">${THEMES.map(t => `<option value="${t.id}">${esc(t.label)}</option>`).join('')}</select>
      </div>
      <div class="tb-field">
        <label>Decorative side image URL <span class="tb-optional">(optional, для тем Mono Gray / Mono Glass)</span></label>
        <input type="text" id="tb-theme-img" placeholder="https://example.com/pic.png">
      </div>
    </div>

    <div class="tb-set-section">
      <div class="tb-set-label">Translation provider</div>
      <div class="tb-provider-row">
        <button class="tb-prov" data-prov="google">Google Translate</button>
        <button class="tb-prov" data-prov="libre">LibreTranslate</button>
        <button class="tb-prov" data-prov="deepl">DeepL API</button>
        <button class="tb-prov" data-prov="custom">Custom AI API</button>
      </div>
    </div>

    <div class="tb-prov-panel" id="tb-prov-google">
      <p class="tb-hint">✅ Free — no API key required. Uses Google's public translation endpoint.</p>
      <p class="tb-hint">Supports all languages in the list. Best for quick everyday translations.</p>
      <p class="tb-hint tb-hint-dim">Very long texts (>5000 chars) are automatically split into chunks.</p>
    </div>

    <div class="tb-prov-panel" id="tb-prov-libre">
      <div class="tb-field"><label>Instance URL</label><input type="text" id="tb-libre-url" placeholder="https://libretranslate.com"></div>
      <div class="tb-field"><label>API key <span class="tb-optional">(optional)</span></label><input type="password" id="tb-libre-key" placeholder="Leave blank if not required"></div>
      <p class="tb-hint">Public instance may require a key. You can self-host for free.</p>
    </div>

    <div class="tb-prov-panel" id="tb-prov-deepl">
      <div class="tb-field"><label>DeepL API key</label><input type="password" id="tb-deepl-key" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx"></div>
      <div class="tb-field tb-check-field"><label><input type="checkbox" id="tb-deepl-free"> Use Free tier endpoint (api-free.deepl.com)</label></div>
    </div>

    <div class="tb-prov-panel" id="tb-prov-custom">
      <div class="tb-field"><label>Server / Proxy URL</label><input type="text" id="tb-custom-url" placeholder="https://api.openai.com  or your proxy URL"></div>
      <div class="tb-field"><label>API key</label><input type="password" id="tb-custom-key" placeholder="sk-…"></div>
      <div class="tb-model-row">
        <div class="tb-field tb-grow"><label>Model</label><input type="text" id="tb-custom-model" placeholder="gpt-4o / claude-3-5-haiku / mistral-large…"></div>
        <button class="tb-btn-action tb-secondary tb-sm" id="tb-fetch-models">⟳ Load list</button>
      </div>
      <div id="tb-model-list-wrap" style="display:none" class="tb-field">
        <label>Available models</label>
        <select id="tb-model-select"><option value="">— pick one —</option></select>
      </div>
      <div class="tb-field"><label>System prompt <span class="tb-optional">(for the translator AI)</span></label><textarea id="tb-custom-sys" rows="7"></textarea></div>
    </div>

    <div class="tb-set-footer">
      <button class="tb-btn-action tb-primary" id="tb-save">💾 Save settings</button>
      <span class="tb-save-ok" id="tb-save-ok"></span>
    </div>
  </div>
</div>`;
        document.body.appendChild(m);
        bindModal(m);
        refreshSettingsUI(m);
    }

    function bindModal(m) {
        m.querySelector('.tb-backdrop').addEventListener('click', closeModal);
        m.querySelector('.tb-close').addEventListener('click', closeModal);
        m.querySelectorAll('.tb-tab').forEach(t => {
            t.addEventListener('click', () => {
                m.querySelectorAll('.tb-tab').forEach(x => x.classList.remove('tb-tab-active'));
                m.querySelectorAll('.tb-panel').forEach(x => x.classList.remove('tb-panel-active'));
                t.classList.add('tb-tab-active');
                m.querySelector(`#tb-${t.dataset.tab}`).classList.add('tb-panel-active');
            });
        });
        m.querySelectorAll('.tb-prov').forEach(b => {
            b.addEventListener('click', () => {
                cfg.provider = b.dataset.prov;
                m.querySelectorAll('.tb-prov').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
                m.querySelectorAll('.tb-prov-panel').forEach(p => p.style.display = 'none');
                m.querySelector(`#tb-prov-${cfg.provider}`).style.display = 'flex';
                updateBadge(m);
            });
        });
        m.querySelector('.tb-swap').addEventListener('click', () => {
            const src = m.querySelector('#tb-src-lang'), tgt = m.querySelector('#tb-tgt-lang');
            if (src.value !== 'auto') {
                const sv = src.value; src.value = tgt.value; tgt.value = sv;
                cfg.sourceLang = src.value; cfg.targetLang = tgt.value; saveCfg();
            }
        });
        m.querySelector('#tb-src-lang').addEventListener('change', e => { cfg.sourceLang = e.target.value; saveCfg(); });
        m.querySelector('#tb-tgt-lang').addEventListener('change', e => { cfg.targetLang = e.target.value; saveCfg(); });
        m.querySelector('#tb-fetch-models').addEventListener('click', () => fetchModels(m));
        m.querySelector('#tb-model-select').addEventListener('change', e => {
            if (e.target.value) m.querySelector('#tb-custom-model').value = e.target.value;
        });
        m.querySelector('#tb-do-translate').addEventListener('click', () => doTranslate(m));
        m.querySelector('#tb-accept').addEventListener('click', () => {
            if (!activeTA) return;
            const val = m.querySelector('#tb-result').value;
            if (!val.trim()) return;
            activeTA.value = val;
            activeTA.dispatchEvent(new Event('input', { bubbles: true }));
            activeTA.dispatchEvent(new Event('change', { bubbles: true }));
            setStatus('✓ Applied!', 'ok');
            setTimeout(closeModal, 700);
        });
        m.querySelector('#tb-discard').addEventListener('click', closeModal);
        m.querySelector('#tb-save').addEventListener('click', () => {
            collectSettings(m); saveCfg();
            const ok = m.querySelector('#tb-save-ok');
            ok.textContent = '✓ Saved';
            setTimeout(() => { ok.textContent = ''; }, 2000);
            updateBadge(m);
            applyTheme();
        });
        const themeSel = m.querySelector('#tb-theme');
        if (themeSel) themeSel.addEventListener('change', () => {
            cfg.theme = themeSel.value || 'default';
            saveCfg();
            applyTheme();
        });
        const imgIn = m.querySelector('#tb-theme-img');
        if (imgIn) imgIn.addEventListener('change', () => {
            cfg.themeSideImg = imgIn.value.trim();
            saveCfg();
            applyTheme();
        });
    }

    function openModal(text) {
        buildModal();
        const m = document.getElementById('translator-modal');
        refreshSettingsUI(m);
        m.querySelector('#tb-orig').value = text || '';
        m.querySelector('#tb-result').value = '';
        m.querySelector('#tb-accept').disabled = true;
        setStatus('');
        m.querySelectorAll('.tb-tab').forEach(t => t.classList.remove('tb-tab-active'));
        m.querySelectorAll('.tb-panel').forEach(p => p.classList.remove('tb-panel-active'));
        m.querySelector('[data-tab="translate"]').classList.add('tb-tab-active');
        m.querySelector('#tb-translate').classList.add('tb-panel-active');
        m.classList.add('tb-open');
    }

    function closeModal() {
        const m = document.getElementById('translator-modal');
        if (m) m.classList.remove('tb-open');
        activeTA = null;
    }

    function refreshSettingsUI(m) {
        m.querySelectorAll('.tb-prov').forEach(b => b.classList.remove('active'));
        const pb = m.querySelector(`.tb-prov[data-prov="${cfg.provider}"]`);
        if (pb) pb.classList.add('active');
        m.querySelectorAll('.tb-prov-panel').forEach(p => p.style.display = 'none');
        const pp = m.querySelector(`#tb-prov-${cfg.provider}`);
        if (pp) pp.style.display = 'flex';
        m.querySelector('#tb-src-lang').value = cfg.sourceLang;
        m.querySelector('#tb-tgt-lang').value = cfg.targetLang;
        m.querySelector('#tb-libre-url').value = cfg.libre.url;
        m.querySelector('#tb-libre-key').value = cfg.libre.apiKey;
        m.querySelector('#tb-deepl-key').value = cfg.deepl.apiKey;
        m.querySelector('#tb-deepl-free').checked = cfg.deepl.freeApi;
        m.querySelector('#tb-custom-url').value = cfg.custom.url;
        m.querySelector('#tb-custom-key').value = cfg.custom.apiKey;
        m.querySelector('#tb-custom-model').value = cfg.custom.model;
        m.querySelector('#tb-custom-sys').value = cfg.custom.systemPrompt;
        const themeSel = m.querySelector('#tb-theme');
        if (themeSel) themeSel.value = cfg.theme || 'default';
        const imgIn = m.querySelector('#tb-theme-img');
        if (imgIn) imgIn.value = cfg.themeSideImg || '';
        updateBadge(m);
        applyTheme();
    }

    function collectSettings(m) {
        cfg.sourceLang = m.querySelector('#tb-src-lang').value;
        cfg.targetLang = m.querySelector('#tb-tgt-lang').value;
        cfg.libre.url = m.querySelector('#tb-libre-url').value.trim();
        cfg.libre.apiKey = m.querySelector('#tb-libre-key').value.trim();
        cfg.deepl.apiKey = m.querySelector('#tb-deepl-key').value.trim();
        cfg.deepl.freeApi = m.querySelector('#tb-deepl-free').checked;
        cfg.custom.url = m.querySelector('#tb-custom-url').value.trim().replace(/\/$/, '');
        cfg.custom.apiKey = m.querySelector('#tb-custom-key').value.trim();
        cfg.custom.model = m.querySelector('#tb-custom-model').value.trim();
        cfg.custom.systemPrompt = m.querySelector('#tb-custom-sys').value;
        const themeSel = m.querySelector('#tb-theme');
        if (themeSel) cfg.theme = themeSel.value || 'default';
        const imgIn = m.querySelector('#tb-theme-img');
        if (imgIn) cfg.themeSideImg = imgIn.value.trim();
    }

    function updateBadge(m) {
        const labels = { google: 'Google Translate', libre: 'LibreTranslate', deepl: 'DeepL', custom: 'Custom AI' };
        m.querySelector('#tb-badge').textContent = labels[cfg.provider] || cfg.provider;
    }

    function setStatus(msg, type = '') {
        const el = document.getElementById('tb-status');
        if (!el) return;
        el.textContent = msg;
        el.className = `tb-status${type ? ' tb-st-' + type : ''}`;
    }

    /* ── FETCH MODELS ── */
    async function fetchModels(m) {
        collectSettings(m);
        if (!cfg.custom.url) { setStatus('Enter server URL first.', 'err'); return; }
        const btn = m.querySelector('#tb-fetch-models');
        btn.textContent = '⟳ Loading…'; btn.disabled = true;
        try {
            const res = await fetch(`${cfg.custom.url}/v1/models`, {
                headers: { 'Authorization': `Bearer ${cfg.custom.apiKey}`, 'Content-Type': 'application/json' }
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const models = (data.data || data.models || []).map(x => typeof x === 'string' ? x : x.id).filter(Boolean).sort();
            const sel = m.querySelector('#tb-model-select');
            sel.innerHTML = '<option value="">— pick one —</option>' + models.map(id => `<option value="${esc(id)}">${esc(id)}</option>`).join('');
            m.querySelector('#tb-model-list-wrap').style.display = 'flex';
            btn.textContent = `✓ ${models.length} models`;
        } catch (e) {
            setStatus(`Fetch failed: ${e.message}`, 'err');
            btn.textContent = '⟳ Load list';
        } finally { btn.disabled = false; }
    }

    /* ── TRANSLATION ── */
    async function doTranslate(m) {
        collectSettings(m);
        const text = m.querySelector('#tb-orig').value;
        if (!text.trim()) { setStatus('Nothing to translate.', 'err'); return; }
        const tBtn = m.querySelector('#tb-do-translate');
        tBtn.disabled = true;
        tBtn.innerHTML = '<span class="tb-spin">⟳</span> Translating…';
        m.querySelector('#tb-accept').disabled = true;
        setStatus('Sending request…', 'info');
        try {
            let result;
            if      (cfg.provider === 'google') result = await translateGoogle(text);
            else if (cfg.provider === 'libre')  result = await translateLibre(text);
            else if (cfg.provider === 'deepl')  result = await translateDeepl(text);
            else if (cfg.provider === 'custom') result = await translateCustom(text);
            else throw new Error('Unknown provider');
            m.querySelector('#tb-result').value = result;
            m.querySelector('#tb-accept').disabled = false;
            setStatus('✓ Done — review & accept or edit below.', 'ok');
        } catch (e) {
            setStatus(`Error: ${e.message}`, 'err');
            console.error(`[${EXT}]`, e);
        } finally {
            tBtn.disabled = false;
            tBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> Translate`;
        }
    }

    function splitText(text, maxLen) {
        if (text.length <= maxLen) return [text];
        const chunks = [], paras = text.split(/\n{2,}/);
        let current = '';
        for (const p of paras) {
            const sep = current ? '\n\n' : '';
            if ((current + sep + p).length <= maxLen) { current += sep + p; }
            else {
                if (current) chunks.push(current);
                if (p.length > maxLen) {
                    const sents = p.match(/[^.!?]+[.!?]+\s*/g) || [p];
                    current = '';
                    for (const s of sents) {
                        if ((current + s).length <= maxLen) { current += s; }
                        else { if (current) chunks.push(current); current = s.slice(0, maxLen); }
                    }
                } else { current = p; }
            }
        }
        if (current) chunks.push(current);
        return chunks;
    }

    async function translateGoogle(text) {
        const src = cfg.sourceLang === 'auto' ? 'auto' : cfg.sourceLang;
        const tgt = cfg.targetLang;
        const chunks = splitText(text, 4500);
        const results = [];
        for (const chunk of chunks) {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(src)}&tl=${encodeURIComponent(tgt)}&dt=t&q=${encodeURIComponent(chunk)}`;
            const r = await fetch(url);
            if (!r.ok) throw new Error(`Google Translate HTTP ${r.status}`);
            const data = await r.json();
            if (!data || !data[0]) throw new Error('Unexpected response from Google Translate');
            results.push(data[0].reduce((acc, part) => acc + (part[0] || ''), ''));
        }
        return results.join('\n');
    }

    async function translateLibre(text) {
        const url = `${cfg.libre.url.replace(/\/$/, '')}/translate`;
        const body = { q: text, source: cfg.sourceLang === 'auto' ? 'auto' : cfg.sourceLang, target: cfg.targetLang, format: 'text' };
        if (cfg.libre.apiKey) body.api_key = cfg.libre.apiKey;
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error(`LibreTranslate ${r.status}: ${await r.text()}`);
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        return d.translatedText;
    }

    async function translateDeepl(text) {
        const base = cfg.deepl.freeApi ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
        const MAP = { en:'EN', ru:'RU', uk:'UK', de:'DE', fr:'FR', es:'ES', it:'IT', pt:'PT-PT', pl:'PL', nl:'NL', sv:'SV', tr:'TR', ja:'JA', zh:'ZH', ko:'KO', ar:'AR' };
        const params = new URLSearchParams({ text, target_lang: MAP[cfg.targetLang] || cfg.targetLang.toUpperCase(), auth_key: cfg.deepl.apiKey });
        if (cfg.sourceLang !== 'auto' && MAP[cfg.sourceLang]) params.append('source_lang', MAP[cfg.sourceLang]);
        const r = await fetch(`${base}/v2/translate`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
        if (!r.ok) throw new Error(`DeepL ${r.status}: ${await r.text()}`);
        const d = await r.json();
        return d.translations[0].text;
    }

    async function translateCustom(text) {
        if (!cfg.custom.url)   throw new Error('No server URL — check Settings tab.');
        if (!cfg.custom.model) throw new Error('No model specified — check Settings tab.');
        const src = cfg.sourceLang === 'auto' ? 'Detect the source language automatically' : `from ${langName(cfg.sourceLang)}`;
        const userMsg = `Translate the following text ${src} to ${langName(cfg.targetLang)}:\n\n${text}`;
        const r = await fetch(`${cfg.custom.url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.custom.apiKey}` },
            body: JSON.stringify({ model: cfg.custom.model, temperature: 0.1, max_tokens: Math.min(16000, Math.max(2000, text.length * 4)),
                messages: [{ role: 'system', content: cfg.custom.systemPrompt }, { role: 'user', content: userMsg }] })
        });
        if (!r.ok) {
            let msg = `${r.status}`;
            try { const e = await r.json(); msg = e.error?.message || JSON.stringify(e); } catch {}
            throw new Error(msg);
        }
        const d = await r.json();
        const content = d.choices?.[0]?.message?.content ?? d.content?.[0]?.text ?? d.output?.[0]?.content?.[0]?.text;
        if (!content) throw new Error('Empty response from API');
        return content.trim();
    }

    /* ── OBSERVER ── */
    function initObserver() {
        let scanPending = false;
        function schedScan() {
            if (scanPending) return;
            scanPending = true;
            requestAnimationFrame(() => { scanPending = false; scanAndInject(); });
        }

        // Watch DOM additions AND attribute changes (panels opened via display/class toggle)
        const obs = new MutationObserver(muts => {
            for (const m of muts) {
                if (m.addedNodes.length) { schedScan(); return; }
                if (m.type === 'attributes') { schedScan(); return; }
            }
        });
        obs.observe(document.body, {
            childList: true, subtree: true,
            attributes: true, attributeFilter: ['style', 'class']
        });

        // Rescan on click — catches panels opened by button presses (e.g. persona, alt greetings)
        document.addEventListener('click', () => setTimeout(scanAndInject, 150), { passive: true });
    }

    function init() {
        loadCfg();
        applyTheme();
        scanAndInject();
        initObserver();
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
        console.log(`[${EXT}] loaded ✓  (provider: ${cfg.provider})`);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
