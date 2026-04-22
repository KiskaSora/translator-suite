// ══════════════════════════════════════════════════════════════
//  Переводчик: Набор (Translator Suite) v1.0
//  Объединение двух расширений в одно:
//    • Модуль «Слова»  — двойной клик по слову в чате → перевод/словарь
//    • Модуль «Поля»   — кнопка переводчика в текстареа карточек/лорбуков
//  Единая система кастомизации (цвета + Custom CSS).
// ══════════════════════════════════════════════════════════════
import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';

const EXT = 'translator-suite';

// ── Цвета по умолчанию ────────────────────────────────────────
const DEFAULT_COLORS = {
    accent:    '#8b5cf6',
    bg:        '#0d0d10',
    cardBg:    '#17171f',
    surfaceBg: '#21212c',
    text:      '#eeeef5',
    textMuted: '#68687a',
    border:    '#28283a',
    addBtn:    '#8b5cf6',
    closBtn:   '#21212c',
};

const COLOR_FIELDS = [
    { key: 'accent',    label: 'Акцент / стрелки / выделение' },
    { key: 'addBtn',    label: 'Кнопка «Добавить» / основная' },
    { key: 'closBtn',   label: 'Кнопка «Закрыть» / второстепенная' },
    { key: 'bg',        label: 'Фон оверлея' },
    { key: 'cardBg',    label: 'Фон карточки' },
    { key: 'surfaceBg', label: 'Панели и поля ввода' },
    { key: 'text',      label: 'Основной текст' },
    { key: 'textMuted', label: 'Второстепенный текст' },
    { key: 'border',    label: 'Цвет границы' },
];

// ── Провайдеры перевода (общие для обоих модулей) ────────────
const PROVIDERS = {
    google: {
        label: 'Google Translate',
        needsKey: false, needsUrl: false,
        info: '✅ Бесплатно, без регистрации. Неофициальный публичный endpoint.',
        async fn(text, tl, sl) {
            const chunks = splitText(text, 4500);
            const results = [];
            for (const chunk of chunks) {
                const r = await fetch(
                    'https://translate.googleapis.com/translate_a/single'
                    + '?client=gtx&sl=' + encodeURIComponent(sl || 'auto')
                    + '&tl=' + encodeURIComponent(tl)
                    + '&dt=t&q=' + encodeURIComponent(chunk)
                );
                if (!r.ok) throw new Error('Google HTTP ' + r.status);
                const data = await r.json();
                results.push((data[0] || []).map(x => x[0] || '').join(''));
            }
            return results.join('\n');
        }
    },
    mymemory: {
        label: 'MyMemory',
        needsKey: false, needsUrl: false,
        keyLabel: 'Email (необязательно, увеличивает лимит)',
        info: '✅ Бесплатно. 1000 запросов/день без email, больше — с email.',
        async fn(text, tl, sl, key) {
            const src = (sl && sl !== 'auto') ? sl : 'en';
            const url = 'https://api.mymemory.translated.net/get'
                + '?q=' + encodeURIComponent(text)
                + '&langpair=' + encodeURIComponent(src) + '|' + encodeURIComponent(tl)
                + (key ? '&de=' + encodeURIComponent(key) : '');
            const r = await fetch(url);
            if (!r.ok) throw new Error('MyMemory HTTP ' + r.status);
            const j = await r.json();
            if (j.responseStatus !== 200) throw new Error(j.responseMessage || 'Ошибка MyMemory');
            return j.responseData.translatedText;
        }
    },
    libre: {
        label: 'LibreTranslate',
        needsKey: false, needsUrl: true,
        keyLabel: 'API-ключ (если требует сервер)',
        urlLabel: 'URL сервера LibreTranslate',
        urlPlaceholder: 'https://libretranslate.de',
        info: '🔧 Открытый движок. Публичные серверы: libretranslate.de, translate.argosopentech.com',
        async fn(text, tl, sl, key, url) {
            const base = (url || 'https://libretranslate.de').replace(/\/$/, '');
            const body = { q: text, source: sl || 'auto', target: tl, format: 'text' };
            if (key) body.api_key = key;
            const r = await fetch(base + '/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!r.ok) throw new Error('LibreTranslate HTTP ' + r.status);
            const j = await r.json();
            if (j.error) throw new Error(j.error);
            return j.translatedText;
        }
    },
    deepl: {
        label: 'DeepL',
        needsKey: true, needsUrl: false,
        keyLabel: 'DeepL API-ключ (Free заканчивается на :fx)',
        info: '🔑 Бесплатный ключ: deepl.com/pro-api → Free plan. 500 000 симв./месяц.',
        async fn(text, tl, sl, key) {
            if (!key) throw new Error('Укажи DeepL API-ключ в настройках');
            const ep = key.endsWith(':fx')
                ? 'https://api-free.deepl.com/v2/translate'
                : 'https://api.deepl.com/v2/translate';
            const body = { text: [text], target_lang: tl.toUpperCase() };
            if (sl && sl !== 'auto') body.source_lang = sl.toUpperCase();
            const r = await fetch(ep, {
                method: 'POST',
                headers: {
                    'Authorization': 'DeepL-Auth-Key ' + key,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            if (!r.ok) throw new Error('DeepL HTTP ' + r.status);
            return (await r.json()).translations[0].text;
        }
    },
    yandex: {
        label: 'Yandex Translate',
        needsKey: true, needsUrl: false,
        keyLabel: 'IAM-токен или API-ключ Yandex Cloud',
        info: '🔑 Ключ: console.yandex.cloud → Translate API. Первые 5 млн симв./месяц бесплатно.',
        async fn(text, tl, sl, key) {
            if (!key) throw new Error('Укажи Yandex API-ключ в настройках');
            const body = {
                texts: [text],
                targetLanguageCode: tl,
                ...(sl && sl !== 'auto' ? { sourceLanguageCode: sl } : {})
            };
            const r = await fetch('https://translate.api.cloud.yandex.net/translate/v2/translate', {
                method: 'POST',
                headers: {
                    'Authorization': 'Api-Key ' + key,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            if (!r.ok) throw new Error('Yandex HTTP ' + r.status);
            const j = await r.json();
            if (j.message) throw new Error(j.message);
            return j.translations[0].text;
        }
    },
    custom: {
        label: 'Custom AI (OpenAI-совместимый)',
        needsKey: true, needsUrl: true, hasModel: true,
        keyLabel: 'API-ключ',
        urlLabel: 'URL сервера / прокси',
        urlPlaceholder: 'https://api.openai.com',
        info: '🤖 Любой OpenAI-совместимый эндпоинт: OpenAI, локальный Ollama, прокси и т.п.',
        async fn(text, tl, sl, key, url, extra) {
            if (!url)   throw new Error('Не указан URL сервера');
            const model = (extra && extra.model) || '';
            if (!model) throw new Error('Не указана модель');
            const sys = (extra && extra.systemPrompt) || DEFAULT_CUSTOM_PROMPT;
            const srcStr = (!sl || sl === 'auto')
                ? 'Определи язык оригинала автоматически'
                : 'с языка ' + langName(sl);
            const userMsg = `Переведи следующий текст ${srcStr} на ${langName(tl)}:\n\n${text}`;
            const r = await fetch(url.replace(/\/$/, '') + '/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
                body: JSON.stringify({
                    model, temperature: 0.1,
                    max_tokens: Math.min(16000, Math.max(2000, text.length * 4)),
                    messages: [
                        { role: 'system', content: sys },
                        { role: 'user',   content: userMsg }
                    ]
                })
            });
            if (!r.ok) {
                let msg = 'HTTP ' + r.status;
                try { const e = await r.json(); msg = e.error?.message || JSON.stringify(e); } catch(_) {}
                throw new Error(msg);
            }
            const d = await r.json();
            const content = d.choices?.[0]?.message?.content
                ?? d.content?.[0]?.text
                ?? d.output?.[0]?.content?.[0]?.text;
            if (!content) throw new Error('Пустой ответ от API');
            return content.trim();
        }
    }
};

const DEFAULT_CUSTOM_PROMPT =
`Ты — профессиональный движок перевода. Твоя ЕДИНСТВЕННАЯ задача — переводить текст.

СТРОГИЕ ПРАВИЛА — никогда не нарушай:
• Переводи ВЕСЬ текст полностью, без сокращений и пересказа.
• Сохраняй ВСЕ специальные теги, разметку и форматирование точно как есть:
  {{char}}, {{user}}, <теги>, [теги], *звёздочки*, _подчёркивания_, #заголовки и т.п.
• Сохраняй имена персонажей и термины без изменений, если нет общепринятого перевода.
• НЕ добавляй примечаний, пояснений или комментариев переводчика.
• НЕ оборачивай результат в кавычки или код-блоки.
• Выводи ТОЛЬКО переведённый текст — ничего до, ничего после.`;

const ALL_LANGUAGES = [
    { code: 'auto', label: 'Авто-определение' },
    { code: 'ru',   label: 'Русский' },
    { code: 'uk',   label: 'Украинский' },
    { code: 'en',   label: 'Английский' },
    { code: 'de',   label: 'Немецкий' },
    { code: 'fr',   label: 'Французский' },
    { code: 'es',   label: 'Испанский' },
    { code: 'it',   label: 'Итальянский' },
    { code: 'pt',   label: 'Португальский' },
    { code: 'pl',   label: 'Польский' },
    { code: 'tr',   label: 'Турецкий' },
    { code: 'nl',   label: 'Нидерландский' },
    { code: 'sv',   label: 'Шведский' },
    { code: 'cs',   label: 'Чешский' },
    { code: 'zh',   label: 'Китайский (упрощ.)' },
    { code: 'ja',   label: 'Японский' },
    { code: 'ko',   label: 'Корейский' },
    { code: 'ar',   label: 'Арабский' },
];
const TARGET_LANGS = ALL_LANGUAGES.filter(l => l.code !== 'auto');

// Селекторы текстареа для модуля «Поля» (карточки персонажа, лорбуки и т.д.)
const FIELD_SELECTORS = [
    // ── Карточка персонажа ─────────────────
    '#description', '#personality', '#scenario', '#mes_example',
    '#char_greeting', '#creator_notes', '#system_prompt',
    '#chat_background', '#char_note_text', '#char_note',

    // ── Persona ────────────────────────────
    '#persona_description',
    '#persona_description_block textarea',
    '#personas-block textarea',
    '#persona_block textarea',

    // ── Альтернативные приветствия ─────────
    '.alternate_greeting',
    '.alternate_greeting_block textarea',
    '[id^="alternate_greeting"]',
    '.extra_greeting textarea',

    // ── Расширенные настройки персонажа ────
    '#advanced_character_settings textarea',
    '#character_cross_api_popup textarea',
    '#character_popup textarea',
    '.character_popup_desc_block textarea',
    '.extra_settings_block textarea',
    '.popup-content textarea',

    // ── Редактор/создание персонажа ────────
    '#form_create textarea',
    '#rm_ch_create_block textarea',
    '.character_editor_main textarea',
    '#char_form textarea',

    // ── World Info / Lorebook ──────────────
    '.world_entry_text',
    '.world_entry textarea',
    '.world_entry_form textarea',
    '#worldinfo-search-results textarea',
    '#WorldInfo textarea',
    '.world_info_block textarea',

    // ── Общий запасной селектор ────────────
    '.drawer-content textarea',
    '.inline-drawer-content textarea',
    '#sheld textarea',
    '#right-nav-panel textarea',
];

// ── Init storage ──────────────────────────────────────────────
if (!extension_settings[EXT]) {
    extension_settings[EXT] = {
        // Общие
        provider: 'google', apiKey: '', libreUrl: '',
        sourceLang: 'auto', targetLang: 'ru',
        customModel: '', customSystemPrompt: DEFAULT_CUSTOM_PROMPT,
        colors: { ...DEFAULT_COLORS }, customCss: '',

        // Модули — включены оба по умолчанию
        modWords: true,
        modFields: true,

        // Настройки модуля «Слова»
        vocabulary: [], treasures: [],
        highlightSaved: true, treasuresEnabled: false,
    };
}
const _s = extension_settings[EXT];
if (!_s.colors)                        _s.colors             = { ...DEFAULT_COLORS };
if (!_s.provider)                      _s.provider           = 'google';
if (!_s.targetLang)                    _s.targetLang         = 'ru';
if (_s.sourceLang === undefined)       _s.sourceLang         = 'auto';
if (_s.customCss === undefined)        _s.customCss          = '';
if (_s.customModel === undefined)      _s.customModel        = '';
if (_s.customSystemPrompt === undefined) _s.customSystemPrompt = DEFAULT_CUSTOM_PROMPT;
if (!_s.vocabulary)                    _s.vocabulary         = [];
if (!_s.treasures)                     _s.treasures          = [];
if (_s.highlightSaved === undefined)   _s.highlightSaved     = true;
if (_s.treasuresEnabled === undefined) _s.treasuresEnabled   = false;
if (_s.modWords === undefined)         _s.modWords           = true;
if (_s.modFields === undefined)        _s.modFields          = true;

const cfg = () => extension_settings[EXT];

// ── Текущее состояние карточки слова ─────────────────────────
let cur = { word: '', translation: '', context: '', contextTr: '', chat: '' };

// ── Активный textarea для модуля «Поля» ──────────────────────
let activeTA = null;

// ── Утилиты ──────────────────────────────────────────────────
function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function langName(code) {
    const l = ALL_LANGUAGES.find(x => x.code === code);
    return l ? l.label : code;
}

function splitText(text, maxLen) {
    if (text.length <= maxLen) return [text];
    const chunks = [], paras = text.split(/\n{2,}/);
    let current = '';
    for (const p of paras) {
        const sep = current ? '\n\n' : '';
        if ((current + sep + p).length <= maxLen) current += sep + p;
        else {
            if (current) chunks.push(current);
            if (p.length > maxLen) {
                const sents = p.match(/[^.!?]+[.!?]+\s*/g) || [p];
                current = '';
                for (const s of sents) {
                    if ((current + s).length <= maxLen) current += s;
                    else { if (current) chunks.push(current); current = s.slice(0, maxLen); }
                }
            } else current = p;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

function getSentence(text, word) {
    const parts = text.split(/(?<=[.!?\n])\s+/);
    const lw = word.toLowerCase();
    for (const p of parts) if (p.toLowerCase().includes(lw)) return p.trim();
    const idx = text.toLowerCase().indexOf(lw);
    if (idx < 0) return text.slice(0, 200);
    return text.slice(Math.max(0, idx - 80), idx + 160).trim();
}

function getSentenceFromSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return '';
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    const text = node.textContent || '';
    const offset = range.startOffset;
    let start = offset;
    while (start > 0 && !/[.!?\n]/.test(text[start - 1])) start--;
    let end = offset;
    while (end < text.length && !/[.!?\n]/.test(text[end])) end++;
    return text.slice(start, end).trim();
}

function highlight(sentence, word) {
    const r = esc(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return esc(sentence).replace(new RegExp('(' + r + ')', 'gi'), '<strong>$1</strong>');
}

function getChatName() {
    try { const ctx = getContext(); return (ctx && ctx.name2) ? ctx.name2 : 'Таверна'; }
    catch(e) { return 'Таверна'; }
}

// ── Применение стилей ────────────────────────────────────────
function applyVars() {
    const colors = Object.assign({}, DEFAULT_COLORS, cfg().colors || {});
    const lines = COLOR_FIELDS.map(f => `  --ts-${f.key}: ${colors[f.key] || DEFAULT_COLORS[f.key]};`);
    const css = ':root {\n' + lines.join('\n') + '\n}';
    let el = document.getElementById('ts-css-vars');
    if (!el) { el = document.createElement('style'); el.id = 'ts-css-vars'; document.head.appendChild(el); }
    el.textContent = css;
}

function applyCustomCss() {
    let el = document.getElementById('ts-css-custom');
    if (!el) { el = document.createElement('style'); el.id = 'ts-css-custom'; document.head.appendChild(el); }
    el.textContent = cfg().customCss || '';
}

// ──────────────────────────────────────────────────────────────
//   ПОДСВЕТКА СЛОВ ИЗ СЛОВАРЯ В ЧАТЕ
// ──────────────────────────────────────────────────────────────
function highlightSavedInChat() {
    if (!cfg().modWords) return;
    if (cfg().highlightSaved !== true) return;
    const vocab = cfg().vocabulary;
    if (!vocab.length) return;
    const words = vocab.map(e => e.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp('\\b(' + words.join('|') + ')\\b', 'gi');

    document.querySelectorAll('.mes_text').forEach(function(el) {
        if (el.dataset.tsHighlighted === 'true') return;
        el.dataset.tsHighlighted = 'true';
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
        const nodesToReplace = [];
        let node;
        while ((node = walker.nextNode())) {
            pattern.lastIndex = 0;
            if (pattern.test(node.textContent)) nodesToReplace.push(node);
        }
        nodesToReplace.forEach(function(textNode) {
            const frag = document.createDocumentFragment();
            const text = textNode.textContent;
            let last = 0;
            pattern.lastIndex = 0;
            let m;
            while ((m = pattern.exec(text)) !== null) {
                if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
                const mark = document.createElement('mark');
                mark.className = 'ts-highlight';
                mark.textContent = m[0];
                frag.appendChild(mark);
                last = pattern.lastIndex;
            }
            if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
            textNode.parentNode.replaceChild(frag, textNode);
        });
    });
}

function resetHighlights() {
    document.querySelectorAll('.ts-highlight').forEach(function(el) {
        const txt = document.createTextNode(el.textContent);
        el.parentNode.replaceChild(txt, el);
    });
    document.querySelectorAll('.mes_text[data-ts-highlighted]').forEach(function(el) {
        delete el.dataset.tsHighlighted;
    });
}

// ──────────────────────────────────────────────────────────────
//   UI: HTML (общий, оба модуля)
// ──────────────────────────────────────────────────────────────
function buildUiHtml() {
    const pOpts  = Object.entries(PROVIDERS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('');
    const slOpts = ALL_LANGUAGES.map(l => `<option value="${l.code}">${esc(l.label)}</option>`).join('');
    const tlOpts = TARGET_LANGS.map(l => `<option value="${l.code}">${esc(l.label)} (${l.code})</option>`).join('');
    const cPickers = COLOR_FIELDS.map(f => `
<div class="ts-cr">
  <span class="ts-cr-lbl">${esc(f.label)}</span>
  <div class="ts-cr-inp">
    <input type="color" class="ts-cpick" data-k="${f.key}">
    <input type="text"  class="ts-ctxt"  data-k="${f.key}" maxlength="7" spellcheck="false" placeholder="#000000">
  </div>
</div>`).join('');

    return `
<!-- ═══ Карточка перевода слова (модуль «Слова») ═══ -->
<div id="ts-overlay">
  <div id="ts-card">
    <div id="ts-top">
      <span id="ts-title"></span>
      <div class="ts-hbtns">
        <button class="ts-hb" id="ts-btn-settings" title="Настройки">
          <i class="fa-solid fa-gear"></i>
        </button>
        <button class="ts-hb" id="ts-btn-vocab" title="Мой словарь">
          <i class="fa-solid fa-book-open"></i>
        </button>
      </div>
    </div>
    <div id="ts-trow">
      <i class="fa-solid fa-arrow-right-long ts-arr"></i>
      <span id="ts-tr"></span>
      <i class="fa-solid fa-circle-notch fa-spin" id="ts-spin" style="display:none"></i>
    </div>
    <div id="ts-cru"></div>
    <div id="ts-cen"></div>
    <div id="ts-btns">
      <button id="ts-bclose"><i class="fa-solid fa-xmark"></i> Закрыть</button>
      <button id="ts-badd"><i class="fa-solid fa-bookmark"></i> Добавить</button>
    </div>
  </div>
</div>

<!-- ═══ Словарь ═══ -->
<div id="ts-vo">
  <div id="ts-vp">
    <div class="ts-vhead">
      <span class="ts-vhead-title"><i class="fa-solid fa-book-open"></i> Мой словарь</span>
      <div class="ts-vha">
        <button class="ts-hb" id="ts-btn-treasures" title="Избранное"><i class="fa-solid fa-star"></i></button>
        <button class="ts-hb" id="ts-btn-import" title="Импорт CSV"><i class="fa-solid fa-upload"></i></button>
        <button class="ts-hb" id="ts-btn-export" title="Экспорт CSV"><i class="fa-solid fa-download"></i></button>
        <button class="ts-hb" id="ts-btn-vsettings" title="Настройки"><i class="fa-solid fa-gear"></i></button>
        <button class="ts-hb" id="ts-btn-vclose" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>
    <div id="ts-vsearch">
      <i class="fa-solid fa-magnifying-glass ts-si"></i>
      <input id="ts-vq" type="text" placeholder="Поиск по словарю...">
      <span id="ts-vcnt"></span>
    </div>
    <div id="ts-vl"></div>
  </div>
</div>

<!-- ═══ Избранное ═══ -->
<div id="ts-to">
  <div id="ts-tp">
    <div class="ts-vhead">
      <span class="ts-vhead-title"><i class="fa-solid fa-star"></i> Избранное</span>
      <div class="ts-vha">
        <button class="ts-hb" id="ts-btn-tback" title="Назад к словарю"><i class="fa-solid fa-arrow-left"></i></button>
        <button class="ts-hb" id="ts-btn-tclose" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>
    <div id="ts-tl"></div>
  </div>
</div>

<input type="file" id="ts-import-file" accept=".csv" style="display:none">

<!-- ═══ Плавающая кнопка «В избранное» ═══ -->
<div id="ts-fab" style="display:none">
  <button id="ts-fab-btn"><i class="fa-solid fa-star"></i> В избранное</button>
</div>

<!-- ═══ Модальное окно перевода полей (модуль «Поля») ═══ -->
<div id="ts-fm">
  <div id="ts-fm-card">
    <div class="ts-vhead">
      <span class="ts-vhead-title">
        <i class="fa-solid fa-language"></i> Перевод поля
        <span class="ts-badge" id="ts-fm-badge"></span>
      </span>
      <div class="ts-vha">
        <button class="ts-hb" id="ts-fm-settings" title="Настройки"><i class="fa-solid fa-gear"></i></button>
        <button class="ts-hb" id="ts-fm-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>
    <div class="ts-fm-body">
      <div class="ts-fm-langs">
        <div class="ts-sfield">
          <label><i class="fa-solid fa-magnifying-glass"></i> Из языка</label>
          <select id="ts-fm-src">${slOpts}</select>
        </div>
        <button class="ts-hb" id="ts-fm-swap" title="Поменять местами"><i class="fa-solid fa-right-left"></i></button>
        <div class="ts-sfield">
          <label><i class="fa-solid fa-flag"></i> На язык</label>
          <select id="ts-fm-tgt">${tlOpts}</select>
        </div>
      </div>
      <div class="ts-fm-cols">
        <div class="ts-fm-col">
          <label><i class="fa-solid fa-file-lines"></i> Оригинал</label>
          <textarea id="ts-fm-orig" readonly placeholder="Откройте поле карточки или лорбука и нажмите кнопку переводчика..."></textarea>
        </div>
        <div class="ts-fm-col">
          <label><i class="fa-solid fa-language"></i> Перевод</label>
          <textarea id="ts-fm-result" placeholder="Здесь появится перевод..."></textarea>
        </div>
      </div>
      <div class="ts-fm-actions">
        <button class="ts-fm-btn ts-fm-primary" id="ts-fm-do">
          <i class="fa-solid fa-language"></i> Перевести
        </button>
        <button class="ts-fm-btn ts-fm-success" id="ts-fm-accept" disabled>
          <i class="fa-solid fa-check"></i> Принять и заменить
        </button>
        <button class="ts-fm-btn ts-fm-secondary" id="ts-fm-cancel">
          <i class="fa-solid fa-xmark"></i> Отмена
        </button>
      </div>
      <div class="ts-fm-status" id="ts-fm-status"></div>
    </div>
  </div>
</div>

<!-- ═══ Настройки ═══ -->
<div id="ts-so">
  <div id="ts-sp">
    <div id="ts-shead">
      <span><i class="fa-solid fa-gear"></i> Настройки переводчика</span>
      <button class="ts-hb" id="ts-btn-sx"><i class="fa-solid fa-xmark"></i></button>
    </div>

    <div id="ts-stabs">
      <button class="ts-stab ts-son" data-t="modules"><i class="fa-solid fa-puzzle-piece"></i> Модули</button>
      <button class="ts-stab" data-t="general"><i class="fa-solid fa-language"></i> Перевод</button>
      <button class="ts-stab" data-t="reading"><i class="fa-solid fa-book"></i> Чтение</button>
      <button class="ts-stab" data-t="colors"><i class="fa-solid fa-palette"></i> Цвета</button>
      <button class="ts-stab" data-t="css"><i class="fa-solid fa-code"></i> CSS</button>
    </div>

    <!-- ── Модули ── -->
    <div class="ts-spane" id="ts-spane-modules">
      <div class="ts-toggle-row">
        <div class="ts-toggle-info">
          <span class="ts-toggle-title"><i class="fa-solid fa-book"></i> Модуль «Слова»</span>
          <span class="ts-toggle-desc">Двойной клик по слову в чате → перевод, словарь, избранное</span>
        </div>
        <label class="ts-switch"><input type="checkbox" id="ts-s-modwords"><span class="ts-slider"></span></label>
      </div>
      <div class="ts-toggle-row">
        <div class="ts-toggle-info">
          <span class="ts-toggle-title"><i class="fa-solid fa-pen-to-square"></i> Модуль «Поля»</span>
          <span class="ts-toggle-desc">Кнопка переводчика в полях карточек персонажа и World Info</span>
        </div>
        <label class="ts-switch"><input type="checkbox" id="ts-s-modfields"><span class="ts-slider"></span></label>
      </div>
      <div class="ts-cssinfo">
        <i class="fa-solid fa-circle-info"></i>
        Модули включаются и отключаются мгновенно. Можно использовать только один.
      </div>
    </div>

    <!-- ── Перевод ── -->
    <div class="ts-spane" id="ts-spane-general" style="display:none">
      <div class="ts-sfield">
        <label><i class="fa-solid fa-globe"></i> Провайдер перевода</label>
        <select id="ts-s-provider">${pOpts}</select>
      </div>
      <div class="ts-sfield" id="ts-sf-key">
        <label id="ts-sl-key"><i class="fa-solid fa-key"></i> API-ключ</label>
        <div class="ts-pw">
          <input id="ts-s-key" type="password" placeholder="Введите ключ...">
          <button class="ts-hb ts-eye" id="ts-s-eye" type="button"><i class="fa-solid fa-eye"></i></button>
        </div>
        <div class="ts-note" id="ts-s-keynote"></div>
      </div>
      <div class="ts-sfield" id="ts-sf-url">
        <label><i class="fa-solid fa-server"></i> URL сервера</label>
        <input id="ts-s-url" type="text" placeholder="https://...">
      </div>
      <div class="ts-sfield" id="ts-sf-model">
        <label><i class="fa-solid fa-microchip"></i> Модель</label>
        <div class="ts-row">
          <input id="ts-s-model" type="text" placeholder="gpt-4o / claude-3-5-haiku / mistral-large…">
          <button class="ts-fm-btn ts-fm-secondary" id="ts-s-fetch-models"><i class="fa-solid fa-rotate"></i> Список</button>
        </div>
        <select id="ts-s-model-select" style="display:none; margin-top:8px"><option value="">— выбрать —</option></select>
      </div>
      <div class="ts-sfield" id="ts-sf-sysprompt">
        <label><i class="fa-solid fa-comment"></i> Системный промпт</label>
        <textarea id="ts-s-sysprompt" rows="6"></textarea>
      </div>
      <div class="ts-sfield">
        <label><i class="fa-solid fa-magnifying-glass"></i> Я читаю на</label>
        <select id="ts-s-sourcelang">${slOpts}</select>
      </div>
      <div class="ts-sfield">
        <label><i class="fa-solid fa-flag"></i> Переводить на</label>
        <select id="ts-s-lang">${tlOpts}</select>
      </div>
      <div id="ts-s-pinfo"></div>
    </div>

    <!-- ── Чтение ── -->
    <div class="ts-spane" id="ts-spane-reading" style="display:none">
      <div class="ts-toggle-row">
        <div class="ts-toggle-info">
          <span class="ts-toggle-title"><i class="fa-solid fa-highlighter"></i> Подсвечивать сохранённые слова</span>
          <span class="ts-toggle-desc">Отмечать слова из словаря прямо в тексте чата</span>
        </div>
        <label class="ts-switch"><input type="checkbox" id="ts-s-highlight"><span class="ts-slider"></span></label>
      </div>
      <div class="ts-toggle-row">
        <div class="ts-toggle-info">
          <span class="ts-toggle-title"><i class="fa-solid fa-star"></i> Включить «Избранное»</span>
          <span class="ts-toggle-desc">Выдели текст — появится кнопка «В избранное» рядом с курсором</span>
        </div>
        <label class="ts-switch"><input type="checkbox" id="ts-s-treasures"><span class="ts-slider"></span></label>
      </div>
    </div>

    <!-- ── Цвета ── -->
    <div class="ts-spane" id="ts-spane-colors" style="display:none">
      <div id="ts-cgrid">${cPickers}</div>
      <button id="ts-creset"><i class="fa-solid fa-rotate-left"></i> Сбросить к умолчанию</button>
    </div>

    <!-- ── CSS ── -->
    <div class="ts-spane" id="ts-spane-css" style="display:none">
      <div class="ts-cssinfo">
        <i class="fa-solid fa-circle-info"></i>
        Пишется поверх основных стилей. Доступны CSS-переменные:<br>
        <code>--ts-accent</code> <code>--ts-cardBg</code> <code>--ts-surfaceBg</code>
        <code>--ts-text</code> <code>--ts-border</code> и другие.
      </div>
      <textarea id="ts-s-css" placeholder="/* Пример */&#10;#ts-card { border: 1px solid var(--ts-accent); }"></textarea>
    </div>

    <div id="ts-sfooter">
      <button id="ts-s-save"><i class="fa-solid fa-floppy-disk"></i> Сохранить</button>
    </div>
  </div>
</div>`;
}

// ──────────────────────────────────────────────────────────────
//   Settings UI
// ──────────────────────────────────────────────────────────────
function loadSettingsUI() {
    const c = cfg();
    $('#ts-s-modwords').prop('checked', !!c.modWords);
    $('#ts-s-modfields').prop('checked', !!c.modFields);
    $('#ts-s-provider').val(c.provider || 'google');
    $('#ts-s-key').val(c.apiKey || '').attr('type', 'password');
    $('#ts-s-eye').find('i').attr('class', 'fa-solid fa-eye');
    $('#ts-s-url').val(c.libreUrl || '');
    $('#ts-s-model').val(c.customModel || '');
    $('#ts-s-sysprompt').val(c.customSystemPrompt || DEFAULT_CUSTOM_PROMPT);
    $('#ts-s-sourcelang').val(c.sourceLang || 'auto');
    $('#ts-s-lang').val(c.targetLang || 'ru');
    $('#ts-s-css').val(c.customCss || '');
    $('#ts-s-highlight').prop('checked', c.highlightSaved !== false);
    $('#ts-s-treasures').prop('checked', !!c.treasuresEnabled);
    const colors = Object.assign({}, DEFAULT_COLORS, c.colors || {});
    COLOR_FIELDS.forEach(function(f) {
        const v = colors[f.key] || DEFAULT_COLORS[f.key];
        $('.ts-cpick[data-k="' + f.key + '"]').val(v);
        $('.ts-ctxt[data-k="' + f.key + '"]').val(v);
    });
    updateProviderUI();
}

function updateProviderUI() {
    const pk = $('#ts-s-provider').val() || 'google';
    const p  = PROVIDERS[pk] || PROVIDERS.google;

    if (p.needsKey || p.keyLabel) {
        $('#ts-sf-key').show();
        $('#ts-sl-key').html('<i class="fa-solid fa-key"></i> ' + esc(p.keyLabel || 'API-ключ'));
        $('#ts-s-keynote').text(p.needsKey ? '⚠️ Обязательно для работы' : 'Необязательно');
        $('#ts-s-keynote').toggleClass('ts-req', !!p.needsKey);
    } else {
        $('#ts-sf-key').hide();
    }
    if (p.needsUrl) {
        $('#ts-sf-url').show();
        if (p.urlPlaceholder) $('#ts-s-url').attr('placeholder', p.urlPlaceholder);
    } else $('#ts-sf-url').hide();

    if (p.hasModel) { $('#ts-sf-model').show(); $('#ts-sf-sysprompt').show(); }
    else            { $('#ts-sf-model').hide(); $('#ts-sf-sysprompt').hide(); }

    if (p.info) $('#ts-s-pinfo').text(p.info).show();
    else        $('#ts-s-pinfo').hide();
}

async function fetchModels() {
    const url = ($('#ts-s-url').val() || '').trim().replace(/\/$/, '');
    const key = $('#ts-s-key').val() || '';
    if (!url) { alert('Сначала укажи URL сервера'); return; }
    const $btn = $('#ts-s-fetch-models');
    const orig = $btn.html();
    $btn.html('<i class="fa-solid fa-circle-notch fa-spin"></i> Загрузка...');
    try {
        const r = await fetch(url + '/v1/models', {
            headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        const models = (data.data || data.models || []).map(x => typeof x === 'string' ? x : x.id).filter(Boolean).sort();
        const $sel = $('#ts-s-model-select');
        $sel.html('<option value="">— выбрать (' + models.length + ') —</option>'
            + models.map(id => `<option value="${esc(id)}">${esc(id)}</option>`).join(''));
        $sel.show();
        $btn.html('<i class="fa-solid fa-check"></i> ' + models.length);
    } catch(e) {
        alert('Ошибка загрузки моделей: ' + e.message);
        $btn.html(orig);
    }
}

function saveSettingsFromUI() {
    const c = cfg();
    c.modWords         = !!$('#ts-s-modwords').prop('checked');
    c.modFields        = !!$('#ts-s-modfields').prop('checked');
    c.provider         = $('#ts-s-provider').val() || 'google';
    c.apiKey           = $('#ts-s-key').val() || '';
    c.libreUrl         = ($('#ts-s-url').val() || '').trim().replace(/\/$/, '');
    c.customModel      = ($('#ts-s-model').val() || '').trim();
    c.customSystemPrompt = $('#ts-s-sysprompt').val() || DEFAULT_CUSTOM_PROMPT;
    c.sourceLang       = $('#ts-s-sourcelang').val() || 'auto';
    c.targetLang       = $('#ts-s-lang').val() || 'ru';
    c.customCss        = $('#ts-s-css').val() || '';
    c.highlightSaved   = !!$('#ts-s-highlight').prop('checked');
    c.treasuresEnabled = !!$('#ts-s-treasures').prop('checked');
    if (!c.colors) c.colors = {};
    COLOR_FIELDS.forEach(function(f) {
        const v = $('.ts-cpick[data-k="' + f.key + '"]').val();
        if (v) c.colors[f.key] = v;
    });
    saveSettingsDebounced();
    applyVars();
    applyCustomCss();
    resetHighlights();
    if (c.modWords && c.highlightSaved === true) highlightSavedInChat();
    refreshFieldButtons();
    updateFmBadge();
    $('#ts-s-save').html('<i class="fa-solid fa-check"></i> Сохранено!').addClass('ts-ok');
    setTimeout(function() {
        $('#ts-s-save').html('<i class="fa-solid fa-floppy-disk"></i> Сохранить').removeClass('ts-ok');
    }, 1600);
}

// ──────────────────────────────────────────────────────────────
//   Карточка перевода слова
// ──────────────────────────────────────────────────────────────
async function translateWith(text, sl, tl) {
    const c = cfg();
    const provider = PROVIDERS[c.provider] || PROVIDERS.google;
    return await provider.fn(text, tl, sl, c.apiKey || '', c.libreUrl || '', {
        model: c.customModel, systemPrompt: c.customSystemPrompt
    });
}

async function showCard(word, $el) {
    cur = { word: word, translation: '', context: '', contextTr: '', chat: '' };
    const already = cfg().vocabulary.some(e => e.word.toLowerCase() === word.toLowerCase());
    $('#ts-title').text(word);
    $('#ts-tr').text('');
    $('#ts-spin').show();
    $('#ts-cru, #ts-cen').html('');
    if (already) $('#ts-badd').html('<i class="fa-solid fa-check"></i> Уже в словаре').attr('class', 'ts-already');
    else         $('#ts-badd').html('<i class="fa-solid fa-bookmark"></i> Добавить').attr('class', '');
    $('#ts-overlay').addClass('ts-on');
    try {
        const fromSel = getSentenceFromSelection();
        cur.context = fromSel || getSentence($el.text() || '', word);
        cur.chat    = getChatName();
        const c  = cfg();
        const sl = c.sourceLang || 'auto';
        const tl = c.targetLang || 'ru';
        const [wt, st] = await Promise.all([
            translateWith(word,        sl, tl),
            translateWith(cur.context, sl, tl)
        ]);
        cur.translation = wt;
        cur.contextTr   = st;
        $('#ts-tr').text(wt);
        $('#ts-cru').html(highlight(st, wt));
        $('#ts-cen').text(cur.context);
    } catch(e) {
        $('#ts-tr').text('Ошибка: ' + e.message);
        console.error('[TranslatorSuite]', e);
    } finally {
        $('#ts-spin').hide();
    }
}
function hideCard() { $('#ts-overlay').removeClass('ts-on'); }

function addWord() {
    const vocab = cfg().vocabulary;
    if (vocab.some(e => e.word.toLowerCase() === cur.word.toLowerCase())) {
        $('#ts-badd').html('<i class="fa-solid fa-check"></i> Уже есть').attr('class', 'ts-already');
        setTimeout(hideCard, 900);
        return;
    }
    vocab.push({
        word: cur.word, translation: cur.translation,
        context: cur.context, contextTr: cur.contextTr,
        chat: cur.chat, date: new Date().toISOString()
    });
    saveSettingsDebounced();
    $('#ts-badd').html('<i class="fa-solid fa-check"></i> Сохранено!').attr('class', 'ts-saved');
    setTimeout(hideCard, 1100);
    setTimeout(() => { if (cfg().highlightSaved) { resetHighlights(); highlightSavedInChat(); } }, 1200);
}

// ──────────────────────────────────────────────────────────────
//   Словарь
// ──────────────────────────────────────────────────────────────
function renderVocab() {
    const q     = ($('#ts-vq').val() || '').toLowerCase();
    const vocab = cfg().vocabulary;
    const list  = q
        ? vocab.filter(e => e.word.toLowerCase().includes(q) || (e.translation || '').toLowerCase().includes(q))
        : vocab;
    $('#ts-vcnt').text(list.length + ' слов');
    if (!list.length) {
        $('#ts-vl').html('<div class="ts-vempty"><i class="fa-solid fa-book-open"></i><br>Словарь пуст<br><small>Двойной клик на слово → Добавить</small></div>');
        return;
    }
    $('#ts-vl').html(list.slice().reverse().map(function(entry) {
        const ri = vocab.indexOf(entry);
        const d  = new Date(entry.date).toLocaleDateString('ru-RU');
        return '<div class="ts-ve">'
            + '<button class="ts-vdel" data-i="' + ri + '" title="Удалить"><i class="fa-solid fa-trash"></i></button>'
            + '<div class="ts-ve-words">'
            +   '<span class="ts-vw">' + esc(entry.word) + '</span>'
            +   '<i class="fa-solid fa-arrow-right ts-va"></i>'
            +   '<span class="ts-vt">' + esc(entry.translation) + '</span>'
            + '</div>'
            + (entry.contextTr ? '<div class="ts-ve-ctx">'  + esc(entry.contextTr) + '</div>' : '')
            + (entry.context   ? '<div class="ts-ve-orig">' + esc(entry.context)   + '</div>' : '')
            + '<div class="ts-ve-meta">'
            +   '<i class="fa-solid fa-gamepad"></i> ' + esc(entry.chat)
            +   ' &middot; <i class="fa-regular fa-calendar"></i> ' + d
            + '</div>'
            + '</div>';
    }).join(''));
    $('#ts-vl .ts-vdel').on('click', function() {
        cfg().vocabulary.splice(parseInt($(this).data('i'), 10), 1);
        saveSettingsDebounced();
        if (cfg().highlightSaved) { resetHighlights(); highlightSavedInChat(); }
        renderVocab();
    });
}
function showVocab() { renderVocab(); $('#ts-vo').addClass('ts-on'); }
function hideVocab() { $('#ts-vo').removeClass('ts-on'); }

// ──────────────────────────────────────────────────────────────
//   Избранное
// ──────────────────────────────────────────────────────────────
function renderTreasures() {
    const list = cfg().treasures || [];
    if (!list.length) {
        $('#ts-tl').html('<div class="ts-vempty"><i class="fa-solid fa-star"></i><br>Избранное пусто<br><small>Включи «Избранное» в настройках Чтения,<br>выдели текст и нажми кнопку рядом с курсором</small></div>');
        return;
    }
    $('#ts-tl').html(list.slice().reverse().map(function(t, revIdx) {
        const ri = list.length - 1 - revIdx;
        const d  = new Date(t.date).toLocaleDateString('ru-RU');
        return '<div class="ts-ve">'
            + '<button class="ts-vdel" data-ti="' + ri + '" title="Удалить"><i class="fa-solid fa-trash"></i></button>'
            + '<div class="ts-te-quote"><i class="fa-solid fa-quote-left ts-qi"></i> ' + esc(t.text) + '</div>'
            + '<div class="ts-ve-meta"><i class="fa-solid fa-gamepad"></i> ' + esc(t.chat)
            + ' &middot; <i class="fa-regular fa-calendar"></i> ' + d + '</div>'
            + '</div>';
    }).join(''));
    $('#ts-tl .ts-vdel').on('click', function() {
        cfg().treasures.splice(parseInt($(this).data('ti'), 10), 1);
        saveSettingsDebounced();
        renderTreasures();
    });
}
function showTreasures() { renderTreasures(); $('#ts-to').addClass('ts-on'); }
function hideTreasures() { $('#ts-to').removeClass('ts-on'); }
function hideFab() { $('#ts-fab').hide().removeData('text'); }

function saveTreasure(text) {
    cfg().treasures.push({ text: text, chat: getChatName(), date: new Date().toISOString() });
    saveSettingsDebounced();
    showToast('⭐ Добавлено в Избранное');
}

// ──────────────────────────────────────────────────────────────
//   Настройки — открыть/закрыть
// ──────────────────────────────────────────────────────────────
function openSettings(tab) {
    loadSettingsUI();
    const t = tab || 'modules';
    $('.ts-stab').removeClass('ts-son');
    $('.ts-stab[data-t="' + t + '"]').addClass('ts-son');
    $('.ts-spane').hide();
    $('#ts-spane-' + t).show();
    $('#ts-so').addClass('ts-on');
}
function closeSettings() { $('#ts-so').removeClass('ts-on'); }

// ──────────────────────────────────────────────────────────────
//   CSV import/export
// ──────────────────────────────────────────────────────────────
function exportCSV() {
    const vocab = cfg().vocabulary;
    if (!vocab.length) { alert('Словарь пуст!'); return; }
    const rows = [['Слово', 'Перевод', 'Контекст (перевод)', 'Контекст (оригинал)', 'Ролёвка', 'Дата']].concat(
        vocab.map(e => [e.word, e.translation, e.contextTr || '', e.context || '', e.chat, new Date(e.date).toLocaleDateString('ru-RU')])
    );
    const csv = rows.map(r => r.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'vocabulary.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
}

function importCSV(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const text  = e.target.result.replace(/^\uFEFF/, '');
            const lines = text.split(/\r?\n/).filter(Boolean);
            if (lines.length < 2) { alert('Файл пуст или повреждён'); return; }
            const first = parseCSVLine(lines[0]);
            const hasHeader = /слово|word/i.test(first[0]);
            const dataLines = hasHeader ? lines.slice(1) : lines;
            let added = 0, skipped = 0;
            const vocab = cfg().vocabulary;
            dataLines.forEach(function(line) {
                const cells = parseCSVLine(line);
                if (cells.length < 2) return;
                const word = (cells[0] || '').trim();
                const translation = (cells[1] || '').trim();
                const contextTr   = (cells[2] || '').trim();
                const context     = (cells[3] || '').trim();
                const chat        = (cells[4] || 'Таверна').trim();
                const date        = cells[5] ? parseRuDate(cells[5]) : new Date().toISOString();
                if (!word) return;
                if (vocab.some(v => v.word.toLowerCase() === word.toLowerCase())) { skipped++; return; }
                vocab.push({ word, translation, contextTr, context, chat, date });
                added++;
            });
            saveSettingsDebounced();
            renderVocab();
            if (cfg().highlightSaved) { resetHighlights(); highlightSavedInChat(); }
            alert('✅ Импорт завершён: добавлено ' + added + ', пропущено дубликатов ' + skipped);
        } catch(err) {
            alert('Ошибка импорта: ' + err.message);
        }
    };
    reader.readAsText(file, 'UTF-8');
}

function parseCSVLine(line) {
    const result = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQ) {
            if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (c === '"') inQ = false;
            else cur += c;
        } else {
            if (c === '"') inQ = true;
            else if (c === ',') { result.push(cur); cur = ''; }
            else cur += c;
        }
    }
    result.push(cur);
    return result;
}
function parseRuDate(str) {
    const parts = str.split('.');
    if (parts.length === 3) {
        const d = new Date(+parts[2], +parts[1] - 1, +parts[0]);
        if (!isNaN(d)) return d.toISOString();
    }
    const d = new Date(str);
    return isNaN(d) ? new Date().toISOString() : d.toISOString();
}

// ──────────────────────────────────────────────────────────────
//   Toast
// ──────────────────────────────────────────────────────────────
function showToast(msg) {
    let t = document.getElementById('ts-toast');
    if (!t) { t = document.createElement('div'); t.id = 'ts-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('ts-toast-show');
    clearTimeout(t._tid);
    t._tid = setTimeout(() => t.classList.remove('ts-toast-show'), 2400);
}

// ──────────────────────────────────────────────────────────────
//   МОДУЛЬ «ПОЛЯ» — кнопка переводчика над текстареа
// ──────────────────────────────────────────────────────────────
const FIELD_BTN_SVG = `<i class="fa-solid fa-language"></i>`;

function injectFieldBtn(ta) {
    if (!ta || ta.dataset.tsInjected) return;
    if (ta.closest('#ts-fm') || ta.closest('#ts-so')) return;
    const id = 'tsi-' + Math.random().toString(36).slice(2, 9);
    ta.dataset.tsInjected = id;
    const btn = document.createElement('button');
    btn.className = 'ts-field-btn';
    btn.title = 'Перевести поле';
    btn.setAttribute('data-ts-for', id);
    btn.innerHTML = FIELD_BTN_SVG;
    document.body.appendChild(btn);

    let leaveTimer = null;
    function place() {
        const r = ta.getBoundingClientRect();
        if (r.width < 10 || r.height < 10) { btn.classList.remove('ts-fb-visible'); return; }
        btn.style.left = Math.round(r.right - 32) + 'px';
        btn.style.top  = Math.round(r.bottom - 32) + 'px';
    }
    function show() {
        if (!cfg().modFields) return;
        clearTimeout(leaveTimer);
        if (!document.contains(ta)) { btn.remove(); return; }
        place(); btn.classList.add('ts-fb-visible');
    }
    function hide(delay) { leaveTimer = setTimeout(() => btn.classList.remove('ts-fb-visible'), delay || 120); }

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
        btn.classList.remove('ts-fb-visible');
        openFieldModal(ta.value);
    });
}

function scanFieldsAndInject() {
    if (!cfg().modFields) return;
    FIELD_SELECTORS.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
            if (el.tagName === 'TEXTAREA') injectFieldBtn(el);
        });
    });
    document.querySelectorAll('.ts-field-btn[data-ts-for]').forEach(btn => {
        if (!document.querySelector(`[data-ts-injected="${btn.dataset.tsFor}"]`)) btn.remove();
    });
}

function refreshFieldButtons() {
    if (!cfg().modFields) {
        document.querySelectorAll('.ts-field-btn').forEach(b => b.remove());
        document.querySelectorAll('[data-ts-injected]').forEach(el => delete el.dataset.tsInjected);
    } else {
        scanFieldsAndInject();
    }
}

function updateFmBadge() {
    const labels = {
        google: 'Google Translate', mymemory: 'MyMemory', libre: 'LibreTranslate',
        deepl: 'DeepL', yandex: 'Yandex', custom: 'Custom AI'
    };
    $('#ts-fm-badge').text(labels[cfg().provider] || cfg().provider);
}

function openFieldModal(text) {
    updateFmBadge();
    $('#ts-fm-src').val(cfg().sourceLang || 'auto');
    $('#ts-fm-tgt').val(cfg().targetLang || 'ru');
    $('#ts-fm-orig').val(text || '');
    $('#ts-fm-result').val('');
    $('#ts-fm-accept').prop('disabled', true);
    $('#ts-fm-status').text('').removeClass('ts-fm-st-ok ts-fm-st-err ts-fm-st-info');
    $('#ts-fm').addClass('ts-on');
}
function closeFieldModal() { $('#ts-fm').removeClass('ts-on'); activeTA = null; }

function setFmStatus(msg, type) {
    const el = $('#ts-fm-status');
    el.text(msg).removeClass('ts-fm-st-ok ts-fm-st-err ts-fm-st-info');
    if (type) el.addClass('ts-fm-st-' + type);
}

async function doFieldTranslate() {
    const text = $('#ts-fm-orig').val();
    if (!text.trim()) { setFmStatus('Нечего переводить.', 'err'); return; }
    const sl = $('#ts-fm-src').val() || 'auto';
    const tl = $('#ts-fm-tgt').val() || 'ru';
    const $btn = $('#ts-fm-do');
    const orig = $btn.html();
    $btn.prop('disabled', true).html('<i class="fa-solid fa-circle-notch fa-spin"></i> Переводим…');
    setFmStatus('Отправка запроса…', 'info');
    try {
        const result = await translateWith(text, sl, tl);
        $('#ts-fm-result').val(result);
        $('#ts-fm-accept').prop('disabled', false);
        setFmStatus('✓ Готово — проверь и при желании отредактируй.', 'ok');
    } catch(e) {
        setFmStatus('Ошибка: ' + e.message, 'err');
    } finally {
        $btn.prop('disabled', false).html(orig);
    }
}

// ──────────────────────────────────────────────────────────────
//   События
// ──────────────────────────────────────────────────────────────
function setupEvents() {
    // Карточка слова
    $('#ts-overlay').on('click', function(e) { if (e.target === this) hideCard(); });
    $('#ts-bclose').on('click', hideCard);
    $('#ts-badd').on('click', addWord);
    $('#ts-btn-vocab').on('click', () => { hideCard(); showVocab(); });
    $('#ts-btn-settings').on('click', () => { hideCard(); openSettings(); });

    // Словарь
    $('#ts-vo').on('click', function(e) { if (e.target === this) hideVocab(); });
    $('#ts-btn-vclose').on('click', hideVocab);
    $('#ts-btn-export').on('click', exportCSV);
    $('#ts-btn-vsettings').on('click', () => { hideVocab(); openSettings('reading'); });
    $('#ts-vq').on('input', renderVocab);
    $('#ts-btn-treasures').on('click', () => { hideVocab(); showTreasures(); });
    $('#ts-btn-import').on('click', () => $('#ts-import-file').click());
    $('#ts-import-file').on('change', function() {
        if (this.files[0]) importCSV(this.files[0]);
        this.value = '';
    });

    // Избранное
    $('#ts-to').on('click', function(e) { if (e.target === this) hideTreasures(); });
    $('#ts-btn-tclose').on('click', hideTreasures);
    $('#ts-btn-tback').on('click', () => { hideTreasures(); showVocab(); });

    // Настройки
    $('#ts-so').on('click', function(e) { if (e.target === this) closeSettings(); });
    $('#ts-btn-sx').on('click', closeSettings);
    $('#ts-s-save').on('click', saveSettingsFromUI);
    $('#ts-s-provider').on('change', updateProviderUI);
    $('#ts-s-fetch-models').on('click', fetchModels);
    $('#ts-s-model-select').on('change', function() {
        if (this.value) $('#ts-s-model').val(this.value);
    });

    // Тогглы — мгновенное сохранение
    $('#ts-s-modwords').on('change', function() {
        cfg().modWords = !!$(this).prop('checked');
        saveSettingsDebounced();
        if (!cfg().modWords) { hideCard(); hideVocab(); hideTreasures(); hideFab(); resetHighlights(); }
        else if (cfg().highlightSaved) highlightSavedInChat();
    });
    $('#ts-s-modfields').on('change', function() {
        cfg().modFields = !!$(this).prop('checked');
        saveSettingsDebounced();
        refreshFieldButtons();
        if (!cfg().modFields) closeFieldModal();
    });
    $('#ts-s-highlight').on('change', function() {
        cfg().highlightSaved = !!$(this).prop('checked');
        saveSettingsDebounced();
        resetHighlights();
        if (cfg().modWords && cfg().highlightSaved) highlightSavedInChat();
    });
    $('#ts-s-treasures').on('change', function() {
        cfg().treasuresEnabled = !!$(this).prop('checked');
        saveSettingsDebounced();
        if (!cfg().treasuresEnabled) hideFab();
    });

    // Глаз пароля
    $('#ts-s-eye').on('click', function() {
        const inp  = $('#ts-s-key');
        const show = inp.attr('type') === 'password';
        inp.attr('type', show ? 'text' : 'password');
        $(this).find('i').attr('class', show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye');
    });

    // Вкладки настроек
    $('#ts-stabs').on('click', '.ts-stab', function() {
        const t = $(this).data('t');
        $('.ts-stab').removeClass('ts-son');
        $(this).addClass('ts-son');
        $('.ts-spane').hide();
        $('#ts-spane-' + t).show();
    });

    // Пикеры цвета
    $(document).on('input', '.ts-cpick', function() {
        const k = $(this).data('k');
        $('.ts-ctxt[data-k="' + k + '"]').val($(this).val());
    });
    $(document).on('input', '.ts-ctxt', function() {
        const v = $(this).val().trim();
        const k = $(this).data('k');
        if (/^#[0-9a-f]{6}$/i.test(v)) $('.ts-cpick[data-k="' + k + '"]').val(v);
    });
    $('#ts-creset').on('click', function() {
        COLOR_FIELDS.forEach(f => {
            $('.ts-cpick[data-k="' + f.key + '"]').val(DEFAULT_COLORS[f.key]);
            $('.ts-ctxt[data-k="' + f.key + '"]').val(DEFAULT_COLORS[f.key]);
        });
    });

    // Двойной клик / тап → перевод слова (модуль «Слова»)
    let _tsLastTap = 0, _tsLastEl = null, _tsTapTimer = null;
    function handleWordTap(el, x, y) {
        if (!cfg().modWords) return;
        const sel  = window.getSelection();
        let word   = sel ? sel.toString().trim() : '';
        word = word.replace(/^[\s.,!?;:"'()«»\-–—\[\]]+|[\s.,!?;:"'()«»\-–—\[\]]+$/g, '');
        if (!word) {
            const range = document.caretRangeFromPoint
                ? document.caretRangeFromPoint(x, y)
                : (document.caretPositionFromPoint
                    ? (function() {
                        const pos = document.caretPositionFromPoint(x, y);
                        if (!pos) return null;
                        const r = document.createRange();
                        r.setStart(pos.offsetNode, pos.offset);
                        r.setEnd(pos.offsetNode, pos.offset);
                        return r;
                    })() : null);
            if (range) {
                range.expand && range.expand('word');
                sel.removeAllRanges();
                sel.addRange(range);
                word = sel.toString().trim();
                word = word.replace(/^[\s.,!?;:"'()«»\-–—\[\]]+|[\s.,!?;:"'()«»\-–—\[\]]+$/g, '');
            }
        }
        if (!word || word.split(/\s+/).length > 4) return;
        showCard(word, $(el));
    }
    $(document).on('dblclick', '.mes_text', function(e) {
        if (!cfg().modWords) return;
        e.preventDefault();
        handleWordTap(this, e.clientX, e.clientY);
    });
    $(document).on('touchend', '.mes_text', function(e) {
        if (!cfg().modWords) return;
        const now = Date.now(), el = this;
        const t = e.changedTouches[0];
        const x = t ? t.clientX : 0, y = t ? t.clientY : 0;
        if (_tsLastEl === el && now - _tsLastTap < 400) {
            clearTimeout(_tsTapTimer);
            _tsLastTap = 0; _tsLastEl = null;
            e.preventDefault();
            setTimeout(() => handleWordTap(el, x, y), 30);
        } else {
            _tsLastTap = now; _tsLastEl = el;
            clearTimeout(_tsTapTimer);
            _tsTapTimer = setTimeout(() => { _tsLastTap = 0; _tsLastEl = null; }, 420);
        }
    });

    // Кнопка «В избранное»
    function showFab(text, pageX, pageY) {
        if (!cfg().modWords) return;
        if (cfg().treasuresEnabled !== true) return;
        if (!text || text.split(/\s+/).length < 2) return;
        const fab = $('#ts-fab');
        fab.css({ top: (pageY + 12) + 'px', left: pageX + 'px' }).show();
        fab.data('text', text);
    }
    $(document).on('mouseup', '.mes_text', function(e) {
        hideFab();
        const sel  = window.getSelection();
        const text = sel ? sel.toString().trim() : '';
        showFab(text, e.pageX, e.pageY);
    });
    $(document).on('touchend', '.mes_text', function(e) {
        const t = e.changedTouches[0];
        if (!t) return;
        setTimeout(function() {
            hideFab();
            const sel  = window.getSelection();
            const text = sel ? sel.toString().trim() : '';
            showFab(text, t.pageX, t.pageY);
        }, 50);
    });
    $(document).on('mousedown touchstart', function(e) {
        if (!$(e.target).closest('#ts-fab').length) hideFab();
    });
    $('#ts-fab-btn').on('click touchend', function(e) {
        e.stopPropagation();
        const text = $('#ts-fab').data('text');
        if (text) saveTreasure(text);
        hideFab();
    });

    // ── Модальное окно перевода полей (модуль «Поля») ──
    $('#ts-fm').on('click', function(e) { if (e.target === this) closeFieldModal(); });
    $('#ts-fm-close').on('click', closeFieldModal);
    $('#ts-fm-cancel').on('click', closeFieldModal);
    $('#ts-fm-settings').on('click', () => { closeFieldModal(); openSettings('general'); });
    $('#ts-fm-do').on('click', doFieldTranslate);
    $('#ts-fm-swap').on('click', function() {
        const $s = $('#ts-fm-src'), $t = $('#ts-fm-tgt');
        if ($s.val() !== 'auto') {
            const v = $s.val(); $s.val($t.val()); $t.val(v);
        }
    });
    $('#ts-fm-accept').on('click', function() {
        if (!activeTA) return;
        const val = $('#ts-fm-result').val();
        if (!val.trim()) return;
        activeTA.value = val;
        activeTA.dispatchEvent(new Event('input', { bubbles: true }));
        activeTA.dispatchEvent(new Event('change', { bubbles: true }));
        setFmStatus('✓ Применено!', 'ok');
        setTimeout(closeFieldModal, 700);
    });

    // Esc → закрыть любое окно
    $(document).on('keydown', function(e) {
        if (e.key === 'Escape') {
            hideCard(); hideVocab(); hideTreasures(); closeSettings(); closeFieldModal(); hideFab();
        }
    });
}

// ──────────────────────────────────────────────────────────────
//   MutationObserver — следим за появлением новых текстареа
// ──────────────────────────────────────────────────────────────
function initFieldObserver() {
    let pending = false;
    function sched() {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; scanFieldsAndInject(); });
    }
    const obs = new MutationObserver(muts => {
        for (const m of muts) {
            if (m.addedNodes.length || m.type === 'attributes') { sched(); return; }
        }
    });
    obs.observe(document.body, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ['style', 'class']
    });
    document.addEventListener('click', () => setTimeout(scanFieldsAndInject, 150), { passive: true });
}

// ──────────────────────────────────────────────────────────────
//   INIT
// ──────────────────────────────────────────────────────────────
jQuery(async function() {
    try {
        $('#ts-overlay, #ts-vo, #ts-so, #ts-to, #ts-fm, #ts-fab').remove();
        $('body').append(buildUiHtml());
        setupEvents();
        applyVars();
        applyCustomCss();
        updateFmBadge();
        scanFieldsAndInject();
        initFieldObserver();

        if (cfg().modWords && cfg().highlightSaved === true) {
            setTimeout(highlightSavedInChat, 1200);
        }
        try {
            eventSource.on(event_types.MESSAGE_RECEIVED, function() {
                if (cfg().modWords && cfg().highlightSaved === true) setTimeout(highlightSavedInChat, 400);
            });
        } catch(e) { /* нет eventSource */ }

        console.log('[TranslatorSuite] ✅ v1.0 готов | Слова:', cfg().modWords, '| Поля:', cfg().modFields);
    } catch(err) {
        console.error('[TranslatorSuite] ❌ Init error:', err);
    }
});
