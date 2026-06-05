/* ============================================================
   Senior iOS Interview Prep — bilingual reader with hybrid search
   Data from data.js:
     CATEGORIES = [ { id, en, ru }, ... ]
     DATA = { "<catId>": [ { en:{q,a,d,f}, ru:{q,a,d,f} }, ... ] }
   Search:
     - Fuzzy (Fuse.js, instant, offline) for typo-tolerant keyword ranking
     - Semantic (Transformers.js + precomputed embeddings.json) for
       meaning-based, cross-lingual ranking — model lazy-loaded on first search
   ============================================================ */

(function () {
  "use strict";

  const STORE_LEARNED = "iosprep.learned.v1";
  const STORE_THEME = "iosprep.theme.v1";
  const STORE_LANG = "iosprep.lang.v1";

  const MODEL = "Xenova/multilingual-e5-small";
  const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";
  const SEM_KEEP = 0.79;     // min raw cosine to keep a semantic-only hit
  const MAX_RESULTS = 80;

  // ---- UI strings ----
  const I18N = {
    en: {
      brand: "Senior iOS Interview Prep",
      searchPlaceholder: "Search by meaning or keywords…",
      unlearnedOnly: "Unlearned only",
      expandAll: "Expand all",
      collapseAll: "Collapse all",
      overallProgress: "Overall progress",
      allCategories: "All categories",
      resetProgress: "Reset progress",
      empty: "No questions match your filters.",
      modelAnswer: "Model answer",
      deepDive: "Deep dive",
      followUpTrap: "Follow-up trap",
      learned: "Learned",
      heading: (name, done, total) => `${name} — ${done}/${total} learned`,
      resetConfirm: "Clear all 'learned' checkmarks? This cannot be undone.",
      langSwitchTo: "RU",
      docTitle: "Senior iOS Interview Prep — 300 Q&A",
      results: (n) => `${n} result${n === 1 ? "" : "s"}`,
      semanticTag: "semantic",
      modelLoading: (p) => `🧠 Loading semantic model… ${p}% (one-time ~115 MB, then cached)`,
    },
    ru: {
      brand: "Подготовка к Senior iOS интервью",
      searchPlaceholder: "Поиск по смыслу или ключевым словам…",
      unlearnedOnly: "Только невыученные",
      expandAll: "Развернуть все",
      collapseAll: "Свернуть все",
      overallProgress: "Общий прогресс",
      allCategories: "Все категории",
      resetProgress: "Сбросить прогресс",
      empty: "Ничего не найдено по вашим фильтрам.",
      modelAnswer: "Образцовый ответ",
      deepDive: "Глубокий разбор",
      followUpTrap: "Каверзный follow-up",
      learned: "Выучено",
      heading: (name, done, total) => `${name} — выучено ${done}/${total}`,
      resetConfirm: "Очистить все отметки «выучено»? Это нельзя отменить.",
      langSwitchTo: "EN",
      docTitle: "Подготовка к Senior iOS интервью — 300 вопросов",
      results: (n) => `${n} результат${ruPlural(n)}`,
      semanticTag: "по смыслу",
      modelLoading: (p) => `🧠 Загрузка семантической модели… ${p}% (один раз ~115 МБ, потом из кеша)`,
    },
  };
  function ruPlural(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return "";
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "а";
    return "ов";
  }

  // ---- Build flat model ----
  const categories = [];
  const itemById = new Map();
  let total = 0;
  CATEGORIES.forEach((cat) => {
    const items = (DATA[cat.id] || []).map((it, qi) => {
      const obj = { id: cat.id + "-" + qi, catId: cat.id, n: 0, en: it.en, ru: it.ru };
      itemById.set(obj.id, obj);
      return obj;
    });
    categories.push({ id: cat.id, en: cat.en, ru: cat.ru, items });
    total += items.length;
  });
  let counter = 0;
  categories.forEach((c) => c.items.forEach((it) => (it.n = ++counter)));
  const allItems = [...itemById.values()];
  const catNameById = (id) => {
    const c = categories.find((c) => c.id === id);
    return c ? c[lang] : id;
  };

  // ---- Persistent state ----
  const learned = new Set(loadLearned());
  let lang = localStorage.getItem(STORE_LANG) === "ru" ? "ru" : "en";
  let activeCat = null;
  let query = "";
  let unlearnedOnly = false;

  const t = () => I18N[lang];
  const catName = (cat) => cat[lang];
  const fields = (it) => it[lang];

  // ---- Search infrastructure ----
  let fuse = null;
  let embeddings = null;        // Map id -> { en:Float32Array, ru:Float32Array }
  let extractorPromise = null;  // lazy Transformers.js pipeline
  let searchToken = 0;          // guards against stale async results
  let searchDebounce = null;

  // ---- DOM refs ----
  const $ = (sel) => document.querySelector(sel);
  const cardsEl = $("#cards");
  const navEl = $("#nav");
  const emptyEl = $("#empty");
  const searchEl = $("#search");
  const statusEl = $("#searchStatus");

  // ============================================================
  //  Fuse (fuzzy) index
  // ============================================================
  function buildFuse() {
    if (typeof Fuse === "undefined") return;
    const docs = allItems.map((it) => {
      const f = fields(it);
      return { id: it.id, q: f.q, a: f.a, d: f.d, f: f.f };
    });
    fuse = new Fuse(docs, {
      includeScore: true,
      ignoreLocation: true,
      threshold: 0.4,
      minMatchCharLength: 2,
      keys: [
        { name: "q", weight: 0.5 },
        { name: "a", weight: 0.25 },
        { name: "d", weight: 0.15 },
        { name: "f", weight: 0.1 },
      ],
    });
  }

  // ============================================================
  //  Embeddings (semantic)
  // ============================================================
  function decodeVec(b64) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const i8 = new Int8Array(u8.buffer);
    const f = new Float32Array(i8.length);
    for (let i = 0; i < i8.length; i++) f[i] = i8[i] / 127;
    return f;
  }
  function loadEmbeddings() {
    fetch("embeddings.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        const map = new Map();
        data.ids.forEach((id, i) => {
          map.set(id, { en: decodeVec(data.en[i]), ru: decodeVec(data.ru[i]) });
        });
        embeddings = map;
        if (query) runSearch(); // upgrade current results to hybrid
      })
      .catch(() => { embeddings = null; }); // semantic stays off; fuzzy still works
  }
  function dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }
  function getExtractor() {
    if (!extractorPromise) {
      extractorPromise = import(TRANSFORMERS_CDN).then(async (mod) => {
        mod.env.allowLocalModels = false;
        const ex = await mod.pipeline("feature-extraction", MODEL, {
          quantized: true,
          progress_callback: (e) => {
            if (e.status === "progress" && /model_quantized/.test(e.file || "")) {
              showStatus(t().modelLoading(Math.round(e.progress || 0)));
            }
          },
        });
        return ex;
      });
    }
    return extractorPromise;
  }
  async function embedQuery(text) {
    const ex = await getExtractor();
    const out = await ex("query: " + text, { pooling: "mean", normalize: true });
    return out.data;
  }

  // ============================================================
  //  Rendering — browse vs search
  // ============================================================
  function render() {
    if (query) runSearch();
    else renderBrowse();
  }

  function baseFiltered() {
    return allItems.filter((it) => {
      if (activeCat && it.catId !== activeCat) return false;
      if (unlearnedOnly && learned.has(it.id)) return false;
      return true;
    });
  }

  function renderBrowse() {
    showStatus(null);
    cardsEl.innerHTML = "";
    let shown = 0;
    categories.forEach((cat) => {
      const visible = cat.items.filter((it) => {
        if (activeCat && it.catId !== activeCat) return false;
        if (unlearnedOnly && learned.has(it.id)) return false;
        return true;
      });
      if (!visible.length) return;
      shown += visible.length;
      const heading = document.createElement("div");
      heading.className = "cat-heading";
      const done = cat.items.filter((it) => learned.has(it.id)).length;
      heading.textContent = t().heading(catName(cat), done, cat.items.length);
      cardsEl.appendChild(heading);
      visible.forEach((it) => cardsEl.appendChild(renderCard(it, false)));
    });
    emptyEl.hidden = shown > 0;
    renderNav();
    renderOverall();
  }

  // Hybrid search: instant fuzzy, then re-rank with semantics when ready.
  function runSearch() {
    const token = ++searchToken;
    const base = baseFiltered();
    const q = query;

    // ---- fuzzy ----
    const fuzzyRel = new Map();
    if (fuse) {
      for (const r of fuse.search(q)) {
        fuzzyRel.set(r.item.id, 1 - (r.score ?? 1)); // 0..1, higher = better
      }
    }

    const haveSem = embeddings && extractorReady();
    if (!haveSem) {
      // Render fuzzy immediately; kick off semantic in the background.
      const fuzzyList = base
        .filter((it) => fuzzyRel.has(it.id))
        .sort((a, b) => fuzzyRel.get(b.id) - fuzzyRel.get(a.id))
        .slice(0, MAX_RESULTS);
      renderResults(fuzzyList, false);
      if (embeddings) ensureSemantic(q, token);
      return;
    }
    rankHybrid(q, token, base, fuzzyRel);
  }

  let _extractorSettled = false;
  function extractorReady() { return _extractorSettled; }
  function ensureSemantic(q, token) {
    embedQuery(q).then(() => {
      _extractorSettled = true;
      showStatus(null);
      if (token === searchToken && query === q) runSearch();
    }).catch(() => { showStatus(null); });
  }

  function rankHybrid(q, token, base, fuzzyRel) {
    embedQuery(q).then((qv) => {
      if (token !== searchToken || query !== q) return; // stale
      const kept = [];
      for (const it of base) {
        const e = embeddings.get(it.id);
        const semRaw = e ? Math.max(dot(qv, e.en), dot(qv, e.ru)) : 0;
        const fz = fuzzyRel.get(it.id) || 0;
        if (fz > 0 || semRaw >= SEM_KEEP) kept.push({ it, fz, semRaw });
      }
      // min-max normalize semRaw across kept
      let lo = Infinity, hi = -Infinity;
      for (const k of kept) { lo = Math.min(lo, k.semRaw); hi = Math.max(hi, k.semRaw); }
      const span = hi - lo || 1;
      for (const k of kept) {
        const semRel = (k.semRaw - lo) / span;
        k.score = 0.5 * k.fz + 0.5 * semRel;
      }
      kept.sort((a, b) => b.score - a.score || b.semRaw - a.semRaw);
      renderResults(kept.slice(0, MAX_RESULTS).map((k) => k.it), true);
    }).catch(() => {
      // fall back to fuzzy-only
      const list = base.filter((it) => fuzzyRel.has(it.id))
        .sort((a, b) => fuzzyRel.get(b.id) - fuzzyRel.get(a.id)).slice(0, MAX_RESULTS);
      renderResults(list, false);
    });
  }

  function renderResults(list, semantic) {
    cardsEl.innerHTML = "";
    list.forEach((it) => cardsEl.appendChild(renderCard(it, true)));
    emptyEl.hidden = list.length > 0;
    const tag = semantic ? ` · 🧠 ${t().semanticTag}` : "";
    showStatus(list.length ? t().results(list.length) + tag : null);
    renderNav();
    renderOverall();
  }

  function showStatus(text) {
    if (!text) { statusEl.hidden = true; statusEl.textContent = ""; return; }
    statusEl.hidden = false;
    statusEl.textContent = text;
  }

  // ============================================================
  //  Card
  // ============================================================
  function renderCard(it, showCat) {
    const f = fields(it);
    const card = document.createElement("article");
    card.className = "card" + (learned.has(it.id) ? " learned" : "");
    card.dataset.id = it.id;

    const head = document.createElement("div");
    head.className = "card-head";

    const num = document.createElement("span");
    num.className = "q-num";
    num.textContent = String(it.n).padStart(3, "0");

    const qWrap = document.createElement("div");
    qWrap.className = "q-wrap";
    if (showCat) {
      const pill = document.createElement("span");
      pill.className = "cat-pill";
      pill.textContent = catNameById(it.catId);
      qWrap.appendChild(pill);
    }
    const qText = document.createElement("div");
    qText.className = "q-text";
    qText.innerHTML = highlight(f.q);
    qWrap.appendChild(qText);

    const right = document.createElement("div");
    right.className = "card-head-right";
    const learnLabel = document.createElement("label");
    learnLabel.className = "learn-check";
    learnLabel.addEventListener("click", (e) => e.stopPropagation());
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = learned.has(it.id);
    cb.addEventListener("change", () => toggleLearned(it.id, cb.checked, card));
    const learnTxt = document.createElement("span");
    learnTxt.textContent = t().learned;
    learnLabel.appendChild(cb);
    learnLabel.appendChild(learnTxt);
    const chev = document.createElement("span");
    chev.className = "chevron";
    chev.textContent = "▶";
    right.appendChild(learnLabel);
    right.appendChild(chev);

    head.appendChild(num);
    head.appendChild(qWrap);
    head.appendChild(right);
    head.addEventListener("click", () => card.classList.toggle("open"));

    const body = document.createElement("div");
    body.className = "card-body";
    body.appendChild(block(t().modelAnswer, "answer", f.a));
    body.appendChild(block(t().deepDive, "deep", f.d));
    body.appendChild(block(t().followUpTrap, "trap", f.f));

    card.appendChild(head);
    card.appendChild(body);
    return card;
  }

  function block(label, kind, text) {
    const wrap = document.createElement("div");
    wrap.className = "block " + kind;
    const lab = document.createElement("span");
    lab.className = "block-label label-" + kind;
    lab.textContent = label;
    const p = document.createElement("div");
    p.className = "block-text";
    p.innerHTML = highlight(text);
    wrap.appendChild(lab);
    wrap.appendChild(p);
    return wrap;
  }

  function renderNav() {
    navEl.innerHTML = "";
    navEl.appendChild(
      navButton(t().allCategories, total, learned.size, activeCat === null, () => {
        activeCat = null;
        render();
      })
    );
    categories.forEach((cat) => {
      const done = cat.items.filter((it) => learned.has(it.id)).length;
      navEl.appendChild(
        navButton(catName(cat), cat.items.length, done, activeCat === cat.id, () => {
          activeCat = activeCat === cat.id ? null : cat.id;
          render();
          closeSidebarMobile();
        })
      );
    });
  }
  function navButton(name, count, done, active, onClick) {
    const btn = document.createElement("button");
    btn.className = "nav-item" + (active ? " active" : "");
    const nm = document.createElement("span");
    nm.className = "nav-name";
    nm.textContent = name;
    const ct = document.createElement("span");
    ct.className = "nav-count";
    ct.textContent = `${done}/${count}`;
    btn.appendChild(nm);
    btn.appendChild(ct);
    btn.addEventListener("click", onClick);
    return btn;
  }
  function renderOverall() {
    $("#overallCount").textContent = `${learned.size} / ${total}`;
    $("#overallBar").style.width = total ? (learned.size / total) * 100 + "%" : "0%";
  }

  // ============================================================
  //  Helpers
  // ============================================================
  function highlight(text) {
    let s = escapeHtml(text);
    s = s.replace(/`([^`]+)`/g, (_, c) => "<code>" + c + "</code>");
    // Highlight only whole query words (semantic results may have no literal match).
    const words = query.split(/\s+/).filter((w) => w.length >= 2).map(escapeRegExp);
    if (words.length) {
      const re = new RegExp("(" + words.join("|") + ")", "ig");
      s = s.replace(/(<[^>]+>)|([^<]+)/g, (m, tag, txt) =>
        tag ? tag : txt.replace(re, "<mark>$1</mark>")
      );
    }
    return s;
  }
  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function toggleLearned(id, on, cardEl) {
    if (on) learned.add(id);
    else learned.delete(id);
    saveLearned();
    if (cardEl) cardEl.classList.toggle("learned", on);
    if (unlearnedOnly && on) render();
    else {
      renderNav();
      renderOverall();
      if (!query) refreshHeadings();
    }
  }
  function refreshHeadings() {
    const headings = cardsEl.querySelectorAll(".cat-heading");
    let i = 0;
    categories.forEach((cat) => {
      const visible = cat.items.filter((it) => {
        if (activeCat && it.catId !== activeCat) return false;
        if (unlearnedOnly && learned.has(it.id)) return false;
        return true;
      });
      if (!visible.length) return;
      const done = cat.items.filter((it) => learned.has(it.id)).length;
      if (headings[i]) headings[i].textContent = t().heading(catName(cat), done, cat.items.length);
      i++;
    });
  }

  function loadLearned() {
    try { return JSON.parse(localStorage.getItem(STORE_LEARNED) || "[]"); }
    catch (e) { return []; }
  }
  function saveLearned() {
    localStorage.setItem(STORE_LEARNED, JSON.stringify([...learned]));
  }

  // ============================================================
  //  i18n / theme / mobile
  // ============================================================
  function applyI18n() {
    const s = t();
    document.documentElement.lang = lang;
    document.title = s.docTitle;
    $("#brand").textContent = s.brand;
    searchEl.placeholder = s.searchPlaceholder;
    $("#lblUnlearned").textContent = s.unlearnedOnly;
    $("#expandAll").textContent = s.expandAll;
    $("#collapseAll").textContent = s.collapseAll;
    $("#lblOverall").textContent = s.overallProgress;
    $("#resetProgress").textContent = s.resetProgress;
    emptyEl.textContent = s.empty;
    $("#langToggle").textContent = s.langSwitchTo;
  }
  function setLang(next) {
    lang = next;
    localStorage.setItem(STORE_LANG, lang);
    applyI18n();
    buildFuse();
    render();
  }
  function applyTheme(th) {
    document.documentElement.setAttribute("data-theme", th);
    localStorage.setItem(STORE_THEME, th);
  }
  applyTheme(localStorage.getItem(STORE_THEME) || "dark");
  function closeSidebarMobile() {
    if (window.matchMedia("(max-width: 860px)").matches) {
      $("#sidebar").classList.remove("open");
    }
  }

  // ============================================================
  //  Controls
  // ============================================================
  searchEl.addEventListener("input", () => {
    query = searchEl.value.trim().toLowerCase();
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(render, 140);
  });
  $("#unlearnedOnly").addEventListener("change", (e) => {
    unlearnedOnly = e.target.checked;
    render();
  });
  $("#expandAll").addEventListener("click", () =>
    cardsEl.querySelectorAll(".card").forEach((c) => c.classList.add("open"))
  );
  $("#collapseAll").addEventListener("click", () =>
    cardsEl.querySelectorAll(".card").forEach((c) => c.classList.remove("open"))
  );
  $("#langToggle").addEventListener("click", () => setLang(lang === "en" ? "ru" : "en"));
  $("#themeToggle").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    applyTheme(cur === "dark" ? "light" : "dark");
  });
  $("#resetProgress").addEventListener("click", () => {
    if (confirm(t().resetConfirm)) {
      learned.clear();
      saveLearned();
      render();
    }
  });
  $("#menuToggle").addEventListener("click", () =>
    $("#sidebar").classList.toggle("open")
  );

  // ---- Go ----
  applyI18n();
  buildFuse();
  render();
  loadEmbeddings();
})();
