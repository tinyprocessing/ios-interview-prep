/* ============================================================
   Senior iOS Interview Prep — bilingual reader app (vanilla JS)
   Data from data.js:
     CATEGORIES = [ { id, en, ru }, ... ]   // display order + names
     DATA = { "<catId>": [ { en:{q,a,d,f}, ru:{q,a,d,f} }, ... ] }
   ============================================================ */

(function () {
  "use strict";

  const STORE_LEARNED = "iosprep.learned.v1";
  const STORE_THEME = "iosprep.theme.v1";
  const STORE_LANG = "iosprep.lang.v1";

  // ---- UI strings ----
  const I18N = {
    en: {
      brand: "Senior iOS Interview Prep",
      searchPlaceholder: "Search questions & answers…",
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
    },
    ru: {
      brand: "Подготовка к Senior iOS интервью",
      searchPlaceholder: "Поиск по вопросам и ответам…",
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
    },
  };

  // ---- Build flat, indexed model from CATEGORIES + DATA ----
  // Stable id "<catId>-<index>" so learned-state survives language switches.
  const categories = [];
  let total = 0;
  CATEGORIES.forEach((cat) => {
    const items = (DATA[cat.id] || []).map((it, qi) => ({
      id: cat.id + "-" + qi,
      catId: cat.id,
      n: 0,
      en: it.en,
      ru: it.ru,
    }));
    categories.push({ id: cat.id, en: cat.en, ru: cat.ru, items });
    total += items.length;
  });
  let counter = 0;
  categories.forEach((c) => c.items.forEach((it) => (it.n = ++counter)));

  // ---- Persistent state ----
  const learned = new Set(loadLearned());
  let lang = localStorage.getItem(STORE_LANG) === "ru" ? "ru" : "en";
  let activeCat = null;
  let query = "";
  let unlearnedOnly = false;

  const t = () => I18N[lang];
  const catName = (cat) => cat[lang];
  const fields = (it) => it[lang]; // {q,a,d,f} in current language

  // ---- DOM refs ----
  const $ = (sel) => document.querySelector(sel);
  const cardsEl = $("#cards");
  const navEl = $("#nav");
  const emptyEl = $("#empty");
  const searchEl = $("#search");

  // ============================================================
  //  Filtering + rendering
  // ============================================================
  function matchesFilter(it) {
    if (unlearnedOnly && learned.has(it.id)) return false;
    if (activeCat && it.catId !== activeCat) return false;
    if (query) {
      const f = fields(it);
      const hay = (f.q + " " + f.a + " " + f.d + " " + f.f).toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  }

  function render() {
    cardsEl.innerHTML = "";
    let shown = 0;

    categories.forEach((cat) => {
      const visible = cat.items.filter(matchesFilter);
      if (!visible.length) return;
      shown += visible.length;

      const heading = document.createElement("div");
      heading.className = "cat-heading";
      const done = cat.items.filter((it) => learned.has(it.id)).length;
      heading.textContent = t().heading(catName(cat), done, cat.items.length);
      cardsEl.appendChild(heading);

      visible.forEach((it) => cardsEl.appendChild(renderCard(it)));
    });

    emptyEl.hidden = shown > 0;
    renderNav();
    renderOverall();
  }

  function renderCard(it) {
    const f = fields(it);
    const card = document.createElement("article");
    card.className = "card" + (learned.has(it.id) ? " learned" : "");
    card.dataset.id = it.id;

    const head = document.createElement("div");
    head.className = "card-head";

    const num = document.createElement("span");
    num.className = "q-num";
    num.textContent = String(it.n).padStart(3, "0");

    const qText = document.createElement("div");
    qText.className = "q-text";
    qText.innerHTML = highlight(f.q);

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
    head.appendChild(qText);
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
    if (query) {
      const re = new RegExp("(" + escapeRegExp(query) + ")", "ig");
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
      refreshHeadings();
    }
  }

  function refreshHeadings() {
    const headings = cardsEl.querySelectorAll(".cat-heading");
    let i = 0;
    categories.forEach((cat) => {
      const visible = cat.items.filter(matchesFilter);
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
  //  i18n application (static chrome)
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
    render();
  }

  // ============================================================
  //  Theme
  // ============================================================
  function applyTheme(th) {
    document.documentElement.setAttribute("data-theme", th);
    localStorage.setItem(STORE_THEME, th);
  }
  applyTheme(localStorage.getItem(STORE_THEME) || "dark");

  // ============================================================
  //  Mobile sidebar
  // ============================================================
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
    render();
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
  render();
})();
