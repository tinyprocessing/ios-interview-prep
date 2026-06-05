/* ============================================================
   Senior iOS Interview Prep — reader app (vanilla JS)
   Data comes from data.js as a global `DATA` object:
     { "Category name": [ {q, a, d, f}, ... ], ... }
   ============================================================ */

(function () {
  "use strict";

  const STORE_LEARNED = "iosprep.learned.v1";
  const STORE_THEME = "iosprep.theme.v1";

  // ---- Build a flat, indexed model from DATA ----
  // Each item gets a stable id: "<categoryIndex>-<questionIndex>".
  const categories = [];
  let total = 0;
  Object.keys(DATA).forEach((cat, ci) => {
    const items = (DATA[cat] || []).map((it, qi) => ({
      id: ci + "-" + qi,
      cat,
      n: 0, // global number, filled below
      q: it.q || "",
      a: it.a || "",
      d: it.d || "",
      f: it.f || "",
    }));
    categories.push({ name: cat, items });
    total += items.length;
  });
  // Assign global numbers in display order.
  let counter = 0;
  categories.forEach((c) => c.items.forEach((it) => (it.n = ++counter)));

  // ---- Persistent state ----
  const learned = new Set(loadLearned());
  let activeCat = null; // null = all
  let query = "";
  let unlearnedOnly = false;

  // ---- DOM refs ----
  const $ = (sel) => document.querySelector(sel);
  const cardsEl = $("#cards");
  const navEl = $("#nav");
  const emptyEl = $("#empty");
  const searchEl = $("#search");

  // ============================================================
  //  Rendering
  // ============================================================

  function matchesFilter(it) {
    if (unlearnedOnly && learned.has(it.id)) return false;
    if (activeCat && it.cat !== activeCat) return false;
    if (query) {
      const hay = (it.q + " " + it.a + " " + it.d + " " + it.f).toLowerCase();
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
      const learnedInCat = cat.items.filter((it) => learned.has(it.id)).length;
      heading.textContent = `${cat.name} — ${learnedInCat}/${cat.items.length} learned`;
      cardsEl.appendChild(heading);

      visible.forEach((it) => cardsEl.appendChild(renderCard(it)));
    });

    emptyEl.hidden = shown > 0;
    renderNav();
    renderOverall();
  }

  function renderCard(it) {
    const card = document.createElement("article");
    card.className = "card" + (learned.has(it.id) ? " learned" : "");
    card.dataset.id = it.id;

    // Head (click to toggle)
    const head = document.createElement("div");
    head.className = "card-head";

    const num = document.createElement("span");
    num.className = "q-num";
    num.textContent = String(it.n).padStart(3, "0");

    const qText = document.createElement("div");
    qText.className = "q-text";
    qText.innerHTML = highlight(it.q);

    const right = document.createElement("div");
    right.className = "card-head-right";

    const learnLabel = document.createElement("label");
    learnLabel.className = "learn-check";
    learnLabel.title = "Mark as learned";
    learnLabel.addEventListener("click", (e) => e.stopPropagation());
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = learned.has(it.id);
    cb.addEventListener("change", () => toggleLearned(it.id, cb.checked, card));
    const learnTxt = document.createElement("span");
    learnTxt.textContent = "Learned";
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

    // Body
    const body = document.createElement("div");
    body.className = "card-body";
    body.appendChild(block("Model answer", "answer", it.a));
    body.appendChild(block("Deep dive", "deep", it.d));
    body.appendChild(block("Follow-up trap", "trap", it.f));

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
      navButton("All categories", total, learned.size, activeCat === null, () => {
        activeCat = null;
        render();
      })
    );
    categories.forEach((cat) => {
      const learnedInCat = cat.items.filter((it) => learned.has(it.id)).length;
      navEl.appendChild(
        navButton(cat.name, cat.items.length, learnedInCat, activeCat === cat.name, () => {
          activeCat = activeCat === cat.name ? null : cat.name;
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
    const done = learned.size;
    $("#overallCount").textContent = `${done} / ${total}`;
    $("#overallBar").style.width = total ? (done / total) * 100 + "%" : "0%";
  }

  // ============================================================
  //  Helpers
  // ============================================================

  // Escape HTML, then re-apply `code` backticks and search highlight.
  function highlight(text) {
    let s = escapeHtml(text);
    // `inline code` -> <code>
    s = s.replace(/`([^`]+)`/g, (_, c) => "<code>" + c + "</code>");
    if (query) {
      const re = new RegExp("(" + escapeRegExp(query) + ")", "ig");
      // Avoid highlighting inside tag names by splitting on tags.
      s = s.replace(/(<[^>]+>)|([^<]+)/g, (m, tag, txt) =>
        tag ? tag : txt.replace(re, "<mark>$1</mark>")
      );
    }
    return s;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function toggleLearned(id, on, cardEl) {
    if (on) learned.add(id);
    else learned.delete(id);
    saveLearned();
    if (cardEl) cardEl.classList.toggle("learned", on);
    // If filtering to unlearned, a freshly-learned card should disappear.
    if (unlearnedOnly && on) render();
    else {
      renderNav();
      renderOverall();
      // Update category heading counts without full re-render.
      refreshHeadings();
    }
  }

  function refreshHeadings() {
    const headings = cardsEl.querySelectorAll(".cat-heading");
    let i = 0;
    categories.forEach((cat) => {
      const visible = cat.items.filter(matchesFilter);
      if (!visible.length) return;
      const learnedInCat = cat.items.filter((it) => learned.has(it.id)).length;
      if (headings[i]) headings[i].textContent = `${cat.name} — ${learnedInCat}/${cat.items.length} learned`;
      i++;
    });
  }

  function loadLearned() {
    try {
      return JSON.parse(localStorage.getItem(STORE_LEARNED) || "[]");
    } catch (e) {
      return [];
    }
  }
  function saveLearned() {
    localStorage.setItem(STORE_LEARNED, JSON.stringify([...learned]));
  }

  // ============================================================
  //  Theme
  // ============================================================
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem(STORE_THEME, t);
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
  //  Wire up controls
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

  $("#themeToggle").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    applyTheme(cur === "dark" ? "light" : "dark");
  });

  $("#resetProgress").addEventListener("click", () => {
    if (confirm("Clear all 'learned' checkmarks? This cannot be undone.")) {
      learned.clear();
      saveLearned();
      render();
    }
  });

  $("#menuToggle").addEventListener("click", () =>
    $("#sidebar").classList.toggle("open")
  );

  // ---- Go ----
  render();
})();
