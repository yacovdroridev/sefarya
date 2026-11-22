import "./styles.css";
import { getText, getLinks, getDafYomi, findVideo, findBookAudio, getAudioStream, openExternal, openVideoWindow, clearCache, getCacheStats, getLibraryIndex, lookupName, downloadBook, downloadBooksFast, cancelFastDownload, prefetchRefs, sefariaUrl } from "./api/sefaria.js";
import { SEDARIM, tractateByEn } from "./lib/tractates.js";
import { toHebrewNumeral, stripNikud, sanitize, escapeHtml, formatDibur } from "./lib/hebrew.js";
import { parseSefariaRef, parseUserRef, locToRef } from "./lib/refs.js";
import { groupLinks, defaultColumns, buildColumn, flattenText, CATEGORY_HE } from "./lib/daf.js";
import { flattenLibrary, searchLibrary, formatBytes } from "./lib/library.js";
import { langInfo, tr } from "./lib/i18n.js";

/* ───────────── Settings ───────────── */
const DEFAULTS = {
  fsGemara: 22, fsComm: 16, fsSide: 15, theme: "parchment",
  uiLang: "he", textLang: "hebrew",
  nikud: true, rashiFont: true, paras: false, marks: true, sync: true, dafLayout: true,
  innerPref: "Rashi", outerPref: "Tosafot", sidebar: true, tab: "einMishpat",
  commFilter: [], last: null, history: [], bookmarks: [], downloaded: [],
};
const settings = { ...DEFAULTS, ...safeParse(localStorage.getItem("sefarya.settings")) };
const t = (key, ...args) => tr(settings.uiLang, key, ...args);
function safeParse(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }
function save() { localStorage.setItem("sefarya.settings", JSON.stringify(settings)); }

/* ───────────── State ───────────── */
const state = {
  loc: null, meta: null, segments: [], grouped: null,
  selected: null, token: 0, columns: { inner: null, outer: null },
  video: new Map(), openItems: new Set(),
  library: null, libCat: "ALL", dlAbort: null,
};

const $ = (id) => document.getElementById(id);
const el = {
  tractate: $("tractate-select"), daf: $("daf-select"), amudA: $("amud-a"), amudB: $("amud-b"),
  prev: $("prev-btn"), next: $("next-btn"), searchForm: $("search-form"), search: $("search-input"),
  libraryBtn: $("library-btn"), dafyomi: $("dafyomi-btn"), videoBtn: $("video-btn"), bookmark: $("bookmark-btn"),
  fontInc: $("font-inc"), fontDec: $("font-dec"), sideToggle: $("sidebar-toggle"),
  reader: $("reader"), title: $("daf-title"), status: $("daf-status"),
  gemara: $("gemara-body"), foot: $("gemara-foot"),
  innerSel: $("inner-select"), outerSel: $("outer-select"), inner: $("inner-body"), outer: $("outer-body"),
  tabs: $("tabs"), side: $("side-body"), filterBar: $("filter-bar"), filterLabel: $("filter-label"), filterClear: $("filter-clear"),
  libDialog: $("library-dialog"), libStats: $("lib-stats"), libSearch: $("lib-search"),
  libCats: $("lib-cats"), libList: $("lib-list"), libProgress: $("lib-progress"),
  libProgressText: $("lib-progress-text"), libProgressFill: $("lib-progress-fill"),
  libDlAll: $("lib-dl-all"), libDlCurrent: $("lib-dl-current"),
  libDlCancel: $("lib-dl-cancel"), libDlLinks: $("lib-dl-links"), libClose: $("lib-close"),
  toast: $("toast"),
};

/* ───────────── Helpers ───────────── */
let toastTimer;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), 2600);
}
const skeleton = (n = 12) =>
  `<div class="skel">${Array.from({ length: n }, (_, i) => `<i style="width:${70 + ((i * 37) % 30)}%"></i>`).join("")}</div>`;
const chevron = `<svg class="chev" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>`;
const amudHe = (a) => (a === "a" ? "ע״א" : "ע״ב");
const locHe = (loc) => {
  if (!loc) return "";
  if (loc.tractate) {
    const t = tractateByEn(loc.tractate);
    return `${t ? t.he : loc.tractate} ${toHebrewNumeral(loc.daf)} ${amudHe(loc.amud)}`;
  }
  return loc.heTitle || loc.ref || "";
};
const sameLoc = (a, b) => {
  if (!a || !b) return false;
  if (a.tractate && b.tractate) return a.tractate === b.tractate && a.daf === b.daf && a.amud === b.amud;
  if (a.ref && b.ref) return a.ref === b.ref;
  return false;
};

async function pool(items, limit, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, q.length) }, async () => {
    while (q.length) await fn(q.shift());
  }));
}

/* ───────────── Settings application ───────────── */
function applyI18n() {
  const info = langInfo(settings.uiLang);
  document.documentElement.lang = info.code;
  document.documentElement.dir = info.dir;
  for (const n of document.querySelectorAll("[data-i18n]")) n.textContent = t(n.dataset.i18n);
  for (const n of document.querySelectorAll("[data-i18n-placeholder]")) n.placeholder = t(n.dataset.i18nPlaceholder);
  for (const n of document.querySelectorAll("[data-i18n-title]")) n.title = t(n.dataset.i18nTitle);
  el.gemara.dir = settings.textLang === "english" ? "ltr" : "rtl";
  el.inner.dir = "rtl";
  el.outer.dir = "rtl";
}

function applySettings() {
  const r = document.documentElement;
  r.dataset.theme = settings.theme;
  r.style.setProperty("--fs-gemara", settings.fsGemara + "px");
  r.style.setProperty("--fs-comm", settings.fsComm + "px");
  r.style.setProperty("--fs-side", settings.fsSide + "px");
  document.body.classList.toggle("no-marks", !settings.marks);
  document.body.classList.toggle("no-rashi-font", !settings.rashiFont);
  document.body.classList.toggle("side-hidden", !settings.sidebar);
  el.reader.classList.toggle("paras", settings.paras);
  el.sideToggle.classList.toggle("on", settings.sidebar);
  applySwap();
  applyI18n();
  $("opt-ui-lang").value = settings.uiLang;
  for (const b of $("text-lang-ctl").children) b.classList.toggle("active", b.dataset.tlang === settings.textLang);
  for (const [k, v] of [["fs-gemara", "fsGemara"], ["fs-comm", "fsComm"], ["fs-side", "fsSide"]]) {
    $(k).value = settings[v];
    $(k + "-out").value = settings[v];
  }
  $("opt-nikud").checked = settings.nikud;
  $("opt-rashi-font").checked = settings.rashiFont;
  $("opt-paras").checked = settings.paras;
  $("opt-marks").checked = settings.marks;
  $("opt-sync").checked = settings.sync;
  $("opt-daf-layout").checked = settings.dafLayout;
  for (const b of $("theme-ctl").children) b.classList.toggle("active", b.dataset.theme === settings.theme);
  save();
}

/** On a printed daf, Rashi is on the inner side (toward the binding): right on amud a, left on amud b. */
function applySwap() {
  el.reader.classList.toggle("swap", !!(settings.dafLayout && state.loc?.amud === "b"));
}

function zoom(delta) {
  if (delta === 0) {
    settings.fsGemara = DEFAULTS.fsGemara; settings.fsComm = DEFAULTS.fsComm; settings.fsSide = DEFAULTS.fsSide;
  } else {
    settings.fsGemara = Math.min(40, Math.max(14, settings.fsGemara + delta));
    settings.fsComm = Math.min(30, Math.max(11, settings.fsComm + delta));
  }
  applySettings();
  toast(`גופן גמרא ${settings.fsGemara} · מפרשים ${settings.fsComm}`);
}

/* ───────────── Navigation controls ───────────── */
function buildTractateSelect() {
  const isHe = settings.uiLang === "he";
  el.tractate.innerHTML = SEDARIM.map(
    (s) => `<optgroup label="${isHe ? `סדר ${s.he}` : s.he}">${s.tractates.map(([en, he]) => `<option value="${en}">${isHe ? he : en}</option>`).join("")}</optgroup>`,
  ).join("");
}
function buildDafSelect(t) {
  let html = "";
  for (let d = 2; d <= t.last; d++) html += `<option value="${d}">${toHebrewNumeral(d)}</option>`;
  el.daf.innerHTML = html;
}
function syncControls() {
  if (state.loc?.tractate) {
    const t = tractateByEn(state.loc.tractate);
    if (el.tractate.value !== t.en || el.daf.options.length !== t.last - 1) {
      el.tractate.value = t.en;
      buildDafSelect(t);
    }
    el.daf.value = String(state.loc.daf);
    el.amudA.classList.toggle("active", state.loc.amud === "a");
    el.amudB.classList.toggle("active", state.loc.amud === "b");
  } else {
    el.amudA.classList.remove("active");
    el.amudB.classList.remove("active");
  }
  const bm = settings.bookmarks.some((b) => sameLoc(b, state.loc));
  el.bookmark.classList.toggle("on", bm);
}

function neighbor(dir) {
  const m = state.meta;
  const r = dir > 0 ? m?.next : m?.prev;
  if (r) {
    const p = parseSefariaRef(r);
    return p || { ref: r };
  }
  if (!state.loc?.tractate) return null;
  const { tractate, daf, amud } = state.loc;
  const t = tractateByEn(tractate);
  if (dir > 0) return amud === "a" ? { tractate, daf, amud: "b" } : daf < t.last ? { tractate, daf: daf + 1, amud: "a" } : null;
  return amud === "b" ? { tractate, daf, amud: "a" } : daf > 2 ? { tractate, daf: daf - 1, amud: "b" } : null;
}

/* ───────────── Loading an amud or any library section ───────────── */
async function navigate(loc, { segment = null } = {}) {
  if (!loc) return;
  if (loc.tractate) {
    const t = tractateByEn(loc.tractate);
    if (!t) return toast("מסכת לא מוכרת");
    loc = { tractate: t.en, daf: loc.daf, amud: loc.amud };
  } else if (loc.ref) {
    const p = parseSefariaRef(loc.ref);
    if (p) {
      loc = { tractate: p.tractate, daf: p.daf, amud: p.amud };
      if (!segment && p.segment) segment = p.segment;
    } else {
      loc = { ref: loc.ref, heTitle: loc.heTitle || loc.ref };
    }
  } else {
    return;
  }
  if (sameLoc(loc, state.loc) && state.meta) {
    if (segment) selectSegment(segment, "nav");
    return;
  }
  state.loc = loc;
  state.selected = null;
  state.openItems.clear();
  settings.last = loc;
  settings.history = [loc, ...settings.history.filter((h) => !sameLoc(h, loc))].slice(0, 15);
  save();
  syncControls();
  applySwap();
  renderLists();
  await loadAmud(loc, segment);
}

async function loadAmud(loc, segment) {
  const token = ++state.token;
  const ref = loc.tractate ? locToRef(loc) : loc.ref;
  el.title.textContent = locHe(loc);
  document.title = `${locHe(loc)} – ספריא`;
  el.status.textContent = "טוען…";
  el.gemara.innerHTML = skeleton(16);
  el.inner.innerHTML = skeleton(10);
  el.outer.innerHTML = skeleton(10);
  el.foot.textContent = "";
  el.side.innerHTML = skeleton(8);
  for (const b of [el.gemara, el.inner, el.outer]) b.scrollTop = 0;

  let text, links;
  try {
    const looksResolved = loc.tractate || /\d/.test(ref);
    if (looksResolved) {
      [text, links] = await Promise.all([getText(ref, settings.textLang), getLinks(ref).catch(() => [])]);
      const resolvedRef = text.meta?.sectionRef || text.meta?.ref || ref;
      if (resolvedRef !== ref && !links.length) {
        links = await getLinks(resolvedRef).catch(() => []);
      }
    } else {
      text = await getText(ref, settings.textLang);
      const resolvedRef = text.meta?.sectionRef || text.meta?.ref || ref;
      links = await getLinks(resolvedRef).catch(() => []);
    }
  } catch (e) {
    if (token !== state.token) return;
    el.status.textContent = "";
    el.gemara.innerHTML = `<div class="empty">לא ניתן לטעון את ${escapeHtml(locHe(loc))}<br><small>${escapeHtml(e.message || e)}</small><br><br><button class="pill-btn" id="retry-btn" type="button">נסה שוב</button></div>`;
    $("retry-btn").onclick = () => loadAmud(loc, segment);
    el.inner.innerHTML = el.outer.innerHTML = el.side.innerHTML = "";
    return;
  }
  if (token !== state.token) return;

  state.meta = text.meta;
  const sectionRef = text.meta?.sectionRef || text.meta?.ref || ref;
  if (!loc.tractate) {
    const talmudResolved = parseSefariaRef(sectionRef);
    if (talmudResolved) {
      state.loc = { tractate: talmudResolved.tractate, daf: talmudResolved.daf, amud: talmudResolved.amud };
      settings.last = state.loc;
      settings.history[0] = state.loc;
      save();
      syncControls();
      applySwap();
      renderLists();
    } else {
      state.loc.ref = sectionRef;
      state.loc.heTitle = text.meta?.heRef || loc.heTitle || sectionRef;
      settings.last = state.loc;
      settings.history[0] = state.loc;
      save();
      renderLists();
    }
    el.title.textContent = locHe(state.loc);
    document.title = `${locHe(state.loc)} – ספריא`;
  }
  state.segments = flattenText(text.text);
  state.grouped = groupLinks(links, sectionRef);
  el.status.textContent = text.stale ? "מהמטמון (לא מקוון)" : "";
  el.foot.textContent = [text.versionTitle, text.license].filter(Boolean).join(" · ");
  renderGemara();
  setupColumnSelects();
  renderTabs();
  renderSidebar();
  await Promise.all([loadColumn("inner", token), loadColumn("outer", token)]);
  if (token !== state.token) return;
  if (segment) selectSegment(segment, "nav");
  if (settings.tab === "video") loadVideo();
  // Background-prefetch next & previous sections (+ active Talmud commentators) in Rust so page turns are instant.
  prefetchRefs(
    [state.meta?.next, state.meta?.prev].filter(Boolean),
    settings.textLang,
    { commentators: [state.columns.inner, state.columns.outer].filter(Boolean) },
  );
}

/* ───────────── Gemara ───────────── */
function segMarks(s) {
  const ls = state.grouped?.bySegment.get(s) || [];
  const cnt = { e: 0, t: 0, m: 0 };
  for (const l of ls) {
    if (l.kind === "einMishpat" || l.kind === "halakha") cnt.e++;
    else if (l.kind === "torahOr") cnt.t++;
    else if (l.kind === "mesorat") cnt.m++;
  }
  let h = "";
  if (cnt.e) h += `<button class="mark" data-tab="einMishpat" title="עין משפט / הלכה (${cnt.e})">ע״מ</button>`;
  if (cnt.t) h += `<button class="mark t" data-tab="torahOr" title="תורה אור (${cnt.t})">ת״א</button>`;
  if (cnt.m) h += `<button class="mark m" data-tab="mesorat" title="מסורת הש״ס (${cnt.m})">מ״ה</button>`;
  return h ? `<span class="marks">${h}</span>` : "";
}

function renderGemara() {
  if (!state.segments.length) {
    el.gemara.innerHTML = `<div class="empty">אין טקסט לעמוד זה</div>`;
    return;
  }
  el.gemara.innerHTML = state.segments
    .map((html, i) => {
      let h = sanitize(html);
      if (!settings.nikud) h = stripNikud(h);
      return `<span class="seg" data-seg="${i + 1}">${h}${segMarks(i + 1)}</span>`;
    })
    .join(" ");
  if (state.selected) highlight(state.selected);
}

/* ───────────── Commentary columns ───────────── */
function setupColumnSelects() {
  const cs = state.grouped.commentators;
  const defs = defaultColumns(cs);
  const pick = (pref, def) => cs.find((c) => c.en === pref)?.indexTitle || def;
  state.columns.inner = pick(settings.innerPref, defs.inner);
  state.columns.outer = pick(settings.outerPref, defs.outer);
  if (state.columns.inner === state.columns.outer) state.columns.outer = defs.outer !== state.columns.inner ? defs.outer : null;
  const opts = (sel) =>
    `<option value="">${escapeHtml(t("noneOpt"))}</option>` +
    cs.map((c) => `<option value="${escapeHtml(c.indexTitle)}" ${c.indexTitle === sel ? "selected" : ""}>${escapeHtml(settings.uiLang === "he" ? c.he : c.en)} (${c.count})</option>`).join("");
  el.innerSel.innerHTML = opts(state.columns.inner);
  el.outerSel.innerHTML = opts(state.columns.outer);
}

async function loadColumn(which, token = state.token) {
  const body = which === "inner" ? el.inner : el.outer;
  const indexTitle = state.columns[which];
  if (!indexTitle) {
    body.innerHTML = `<div class="empty">אין פירוש זה בעמוד</div>`;
    return;
  }
  body.innerHTML = skeleton(10);
  const links = state.grouped.groups.commentary.filter((l) => l.indexTitle === indexTitle && l.segments.length);
  const bulkSuffix = state.loc.tractate
    ? `${state.loc.daf}${state.loc.amud}`
    : state.meta?.sections?.length
      ? state.meta.sections.join(":")
      : "";
  let bulk = null;
  if (bulkSuffix) {
    try {
      bulk = (await getText(`${indexTitle} ${bulkSuffix}`)).text;
    } catch { /* fall back to per-comment fetch */ }
  }
  if (token !== state.token) return;
  const items = buildColumn(links, bulk);
  const missing = items.filter((it) => !it.html);
  if (missing.length && missing.length <= 40) {
    await pool(missing, 6, async (it) => {
      try { it.html = flattenText((await getText(it.ref)).text).join(" "); } catch { it.html = ""; }
    });
    if (token !== state.token) return;
  }
  const shown = items.filter((it) => it.html);
  if (!shown.length) {
    body.innerHTML = `<div class="empty">אין פירוש זה בעמוד</div>`;
    return;
  }
  body.innerHTML = shown
    .map((it) => `<span class="cm" data-segs="${it.segments.join(" ")}" data-ref="${escapeHtml(it.ref)}" title="${escapeHtml(it.heRef)}">${formatDibur(sanitize(it.html))}</span>`)
    .join("");
  if (state.selected) highlight(state.selected);
}

/* ───────────── Selection & highlighting ───────────── */
function scrollWithin(container, target, behavior = "smooth") {
  if (!target) return;
  const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 24;
  container.scrollTo({ top, behavior });
}

function highlight(seg, clickedCm = null) {
  for (const n of document.querySelectorAll(".seg.sel, .cm.sel, .cm.rel")) n.classList.remove("sel", "rel");
  if (!seg) return;
  el.gemara.querySelector(`.seg[data-seg="${seg}"]`)?.classList.add("sel");
  for (const body of [el.inner, el.outer]) {
    for (const c of body.querySelectorAll(".cm")) {
      if (c.dataset.segs.split(" ").includes(String(seg))) c.classList.add(c === clickedCm ? "sel" : "rel");
    }
  }
}

function selectSegment(seg, source, clickedCm = null) {
  if (state.selected === seg && source === "gemara") seg = null;
  state.selected = seg;
  highlight(seg, clickedCm);
  if (seg) {
    if (source !== "gemara") scrollWithin(el.gemara, el.gemara.querySelector(`.seg[data-seg="${seg}"]`));
    for (const body of [el.inner, el.outer]) {
      if (clickedCm && body.contains(clickedCm)) continue;
      scrollWithin(body, body.querySelector(".cm.rel, .cm.sel"));
    }
  }
  renderTabs();
  renderSidebar();
}

let syncRaf = 0;
function onGemaraScroll() {
  if (!settings.sync || state.selected) return;
  cancelAnimationFrame(syncRaf);
  syncRaf = requestAnimationFrame(() => {
    const top = el.gemara.getBoundingClientRect().top;
    let seg = 1;
    for (const s of el.gemara.querySelectorAll(".seg")) {
      if (s.getBoundingClientRect().bottom > top + 10) { seg = +s.dataset.seg; break; }
    }
    for (const body of [el.inner, el.outer]) {
      const target = [...body.querySelectorAll(".cm")].find((c) => Math.max(...c.dataset.segs.split(" ").map(Number)) >= seg);
      if (target) scrollWithin(body, target, "instant");
    }
  });
}

/* ───────────── Sidebar ───────────── */
const TABS = [
  { id: "einMishpat", labelKey: "tabEinMishpat", kinds: ["einMishpat", "halakha"] },
  { id: "torahOr", labelKey: "tabTorahOr", kinds: ["torahOr"] },
  { id: "mesorat", labelKey: "tabMesorat", kinds: ["mesorat"] },
  { id: "commentary", labelKey: "tabCommentary", kinds: ["commentary"] },
  { id: "other", labelKey: "tabOther", kinds: ["other"] },
  { id: "video", labelKey: "tabVideo", kinds: [] },
];

const isSteinsaltz = (l) => /steinsaltz/i.test(l.titleEn || l.en || "") || /steinsaltz/i.test(l.indexTitle || "");

function tabItems(tab) {
  if (!state.grouped) return [];
  let items = tab.kinds.flatMap((k) => state.grouped.groups[k]);
  if (tab.id === "commentary") {
    items = items.filter((l) => l.indexTitle !== state.columns.inner && l.indexTitle !== state.columns.outer);
  }
  if (state.selected) {
    items = items.filter((l) => l.segments.includes(state.selected));
  } else {
    items = items.filter((l) => !isSteinsaltz(l));
  }
  return items;
}

function renderTabs() {
  el.tabs.innerHTML = TABS.map((tab) => {
    const n = tab.kinds.length ? tabItems(tab).length : "";
    return `<button class="tab ${settings.tab === tab.id ? "active" : ""}" role="tab" data-tab="${tab.id}" aria-selected="${settings.tab === tab.id}">${escapeHtml(t(tab.labelKey))}${n !== "" ? ` <span class="badge">${n}</span>` : ""}</button>`;
  }).join("");
  el.filterBar.hidden = !state.selected || settings.tab === "video";
  if (state.selected) el.filterLabel.textContent = t("filteredToLine", state.selected);
}

function groupBy(items, keyFn) {
  const m = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
}

function renderSidebar() {
  const tab = TABS.find((t) => t.id === settings.tab) || TABS[0];
  if (tab.id === "video") return renderVideo();
  const items = tabItems(tab);
  let html = "";
  if (tab.id === "commentary" && state.grouped) {
    const all = state.grouped.commentators.filter(
      (c) => c.indexTitle !== state.columns.inner && c.indexTitle !== state.columns.outer && (state.selected || !isSteinsaltz(c)),
    );
    const f = new Set(settings.commFilter);
    if (all.length) {
      html += `<div class="chips-wrap"><div class="chips-label">${escapeHtml(t("chooseCommentators"))}</div><div class="chips">${all
        .map((c) => `<button class="chip ${f.has(c.en) ? "on" : ""}" data-comm="${escapeHtml(c.en)}">${escapeHtml(settings.uiLang === "he" ? c.he : c.en)}</button>`)
        .join("")}</div></div>`;
    }
  }
  let list = items;
  if (tab.id === "commentary" && settings.commFilter.length) {
    const f = new Set(settings.commFilter);
    list = items.filter((l) => f.has(l.titleEn));
  }
  if (!list.length) {
    el.side.innerHTML = html + `<div class="empty">${escapeHtml(state.selected ? t("noSourcesLine") : t("noSourcesPage"))}</div>`;
    return;
  }
  const key = tab.id === "other" ? (l) => (settings.uiLang === "he" ? CATEGORY_HE[l.category] || l.category || "שונות" : l.category || "Other") : (l) => (settings.uiLang === "he" ? l.title : l.titleEn || l.title);
  for (const [title, ls] of groupBy(list, key)) {
    html += `<section class="group"><div class="group-title"><span>${escapeHtml(title)}</span><span class="badge">${ls.length}</span></div><div class="group-items">`;
    for (const l of ls) {
      const open = state.openItems.has(l.ref);
      html += `<div class="item ${open ? "open" : ""}" data-ref="${escapeHtml(l.ref)}">
        <button class="item-head" type="button">${chevron}<span>${escapeHtml(settings.uiLang === "he" ? l.heRef : l.ref)}</span>${l.segments.length ? `<span class="seg-no">${escapeHtml(t("lineNo", l.segments[0]))}</span>` : ""}</button>
        <div class="item-body">${open ? skeleton(3) : ""}</div></div>`;
    }
    html += `</div></section>`;
  }
  el.side.innerHTML = html;
  for (const ref of state.openItems) {
    const item = [...el.side.querySelectorAll(".item")].find((n) => n.dataset.ref === ref);
    if (item) fillItem(item);
  }
}

function findLink(ref) {
  return state.grouped?.links.find((l) => l.ref === ref);
}

async function fillItem(item) {
  const ref = item.dataset.ref;
  const body = item.querySelector(".item-body");
  body.innerHTML = skeleton(3);
  try {
    const t = await getText(ref);
    const parts = flattenText(t.text);
    const link = findLink(ref);
    const talmud = parseSefariaRef(ref);
    body.dir = t.direction === "ltr" ? "ltr" : "rtl";
    body.innerHTML =
      (parts.length ? parts.map((p) => `<p style="margin:0 0 .4em">${formatDibur(sanitize(p))}</p>`).join("") : `<div class="empty">אין טקסט זמין</div>`) +
      (t.versionTitle ? `<div class="version-note">${escapeHtml(t.versionTitle)}${t.license ? " · " + escapeHtml(t.license) : ""}</div>` : "") +
      `<div class="item-actions">
        <button data-act="goto">${escapeHtml(talmud ? t("gotoDaf") : t("openHere"))}</button>
        ${link?.segments.length ? `<button data-act="show" data-seg="${link.segments[0]}">${escapeHtml(t("showInSource"))}</button>` : ""}
        <button data-act="sefaria">${escapeHtml(t("openSefaria"))}</button>
      </div>`;
  } catch (e) {
    body.innerHTML = `<div class="empty">שגיאה בטעינה: ${escapeHtml(e.message || e)}</div>`;
  }
}

/* ───────────── Video & Audio (YouTube for Talmud & all Sefaria books) ───────────── */
const vkey = (loc) => (loc.tractate ? `${loc.tractate}|${loc.daf}|${loc.amud}` : `book|${loc.ref}`);

async function loadVideo(force = false) {
  const loc = state.loc;
  if (!loc) return;
  const key = vkey(loc);
  const cur = state.video.get(key);
  if (cur && !force && cur.status !== "error") return renderVideo();
  state.video.set(key, { status: "loading" });
  renderVideo();
  try {
    if (loc.tractate) {
      const t = tractateByEn(loc.tractate);
      const r = await findVideo(t.he, loc.daf, loc.amud, force);
      const hits = r.hit ? [r.hit] : [];
      state.video.set(key, { status: r.hit ? "found" : "none", ...r, hits, activeIdx: 0 });
    } else {
      const cat = state.meta?.categories?.[0] || "";
      const r = await findBookAudio(locHe(loc), cat, force);
      const hits = r.hits || [];
      state.video.set(key, { status: hits.length ? "found" : "none", ...r, hit: hits[0] || null, hits, activeIdx: 0 });
    }
  } catch (e) {
    state.video.set(key, { status: "error", error: String(e.message || e) });
  }
  if (sameLoc(loc, state.loc)) renderVideo();
}

function renderVideo() {
  if (settings.tab !== "video" || !state.loc) return;
  const isTalmud = !!state.loc.tractate;
  const head = `<div class="group-title"><span>${
    isTalmud ? "שיעור דף יומי – הרב אודי שוורץ · ישיבת הר עציון" : `שיעור ושמע מיוטיוב · ${escapeHtml(locHe(state.loc))}`
  }</span></div>`;
  const v = state.video.get(vkey(state.loc));
  if (!v || v.status === "loading") {
    el.side.innerHTML = head + `<div class="spinner"></div><div class="empty">מחפש שיעור/שמע ל${escapeHtml(locHe(state.loc))}…</div>`;
    if (!v) loadVideo();
    return;
  }
  if (v.status === "error") {
    el.side.innerHTML = head + `<div class="empty">שגיאה: ${escapeHtml(v.error)}</div><div class="video-actions"><button data-vact="retry" class="primary">נסה שוב</button></div>`;
    return;
  }
  if (v.status === "none") {
    el.side.innerHTML = head + `<div class="empty">לא נמצא שיעור תואם ל${escapeHtml(locHe(state.loc))}</div>
      <div class="video-actions"><button data-vact="search" class="primary">חפש ביוטיוב</button><button data-vact="retry">חפש שוב</button></div>`;
    return;
  }
  const hits = v.hits || (v.hit ? [v.hit] : []);
  const h = hits[v.activeIdx || 0] || v.hit;
  const alts = hits.length > 1
    ? `<div class="video-alts">${hits
        .map((x, idx) =>
          idx === (v.activeIdx || 0)
            ? ""
            : `<button type="button" class="video-alt" data-vpick="${idx}"><div><div class="video-alt-title">${escapeHtml(x.title)}</div><div class="video-alt-ch">${escapeHtml(x.channel)}</div></div><span>🎧</span></button>`,
        )
        .join("")}</div>`
    : "";
  el.side.innerHTML = head + `<div class="video-card">
      <div id="video-slot"><button class="video-thumb" data-vact="audio" style="background-image:url('https://i.ytimg.com/vi/${encodeURIComponent(h.id)}/hqdefault.jpg')" aria-label="האזן"></button></div>
      <div class="video-info">
        <div class="video-title">${escapeHtml(h.title)}</div>
        <div class="video-sub">${escapeHtml(h.channel)}${v.from_cache ? " · שמור" : ""}</div>
        <div class="video-actions">
          <button data-vact="audio" class="primary">${escapeHtml(t("listenAudio"))}</button>
          <button data-vact="window">${escapeHtml(t("videoWindow"))}</button>
          <button data-vact="embed">${escapeHtml(t("videoHere"))}</button>
          <button data-vact="browser">${escapeHtml(t("youtube"))}</button>
          <button data-vact="retry">${escapeHtml(t("searchAgain"))}</button>
        </div>
      </div></div>${alts}`;
}

async function onVideoAction(act) {
  const v = state.video.get(vkey(state.loc));
  if (!v) return;
  const h = (v.hits && v.hits[v.activeIdx || 0]) || v.hit;
  switch (act) {
    case "retry": return loadVideo(true);
    case "search": return openExternal(v.search_url);
    case "browser": return openExternal(h.url);
    case "window": return openVideoWindow(h.id, h.title).catch((e) => { toast("פותח בדפדפן"); openExternal(h.url); console.error(e); });
    case "audio": {
      const slot = $("video-slot");
      if (!slot) return;
      slot.innerHTML = `<div class="audio-box"><div class="empty" style="padding:10px">טוען זרם שמע…</div></div>`;
      try {
        const streamUrl = await getAudioStream(h.id);
        slot.innerHTML = `<div class="audio-box">
          <audio id="yt-audio" controls autoplay src="${escapeHtml(streamUrl)}"></audio>
          <div class="audio-speeds">
            <button type="button" data-speed="1" class="on">1×</button>
            <button type="button" data-speed="1.25">1.25×</button>
            <button type="button" data-speed="1.5">1.5×</button>
            <button type="button" data-speed="2">2×</button>
          </div>
        </div>`;
      } catch (e) {
        toast("עובר לנגן מוטמע");
        slot.innerHTML = `<iframe class="video-frame" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(h.id)}?autoplay=1&rel=0" title="${escapeHtml(h.title)}" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
      }
      return;
    }
    case "embed": {
      const slot = $("video-slot");
      slot.innerHTML = `<iframe class="video-frame" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(h.id)}?autoplay=1&rel=0" title="${escapeHtml(h.title)}" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
      return;
    }
  }
}

/* ───────────── Library & Offline Download ───────────── */
async function refreshCacheStats() {
  try {
    const s = await getCacheStats();
    const booksCount = Math.max(s.books_count || 0, settings.downloaded.length);
    el.libStats.textContent = `${booksCount} ספרים מלאים · ${s.sefaria_count} קטעים (${formatBytes(s.db_bytes)})`;
  } catch {
    el.libStats.textContent = "";
  }
}

async function openLibrary() {
  el.libDialog.showModal();
  refreshCacheStats();
  if (!state.library) {
    el.libList.innerHTML = skeleton(12);
    try {
      const toc = await getLibraryIndex();
      state.library = flattenLibrary(toc);
    } catch (e) {
      el.libList.innerHTML = `<div class="empty">לא ניתן לטעון את אינדקס הספרייה: ${escapeHtml(e.message || e)}</div>`;
      return;
    }
  }
  renderLibraryCats();
  renderLibraryList();
  el.libSearch.focus();
}

function renderLibraryCats() {
  if (!state.library) return;
  const isHe = settings.uiLang === "he";
  const cats = [
    { en: "ALL", he: t("libAll"), count: state.library.books.length },
    { en: "DOWNLOADED", he: t("libDownloaded"), count: settings.downloaded.length },
    ...state.library.categories.map((c) => ({ ...c, he: isHe ? c.he : c.en })),
  ];
  el.libCats.innerHTML = cats
    .map((c) => `<button class="chip ${state.libCat === c.en ? "on" : ""}" data-cat="${escapeHtml(c.en)}" type="button">${escapeHtml(c.he)} (${c.count})</button>`)
    .join("");
  const curCat = cats.find((c) => c.en === state.libCat && c.en !== "ALL" && c.en !== "DOWNLOADED");
  el.libDlAll.textContent = curCat ? t("libDlCat", curCat.he) : t("libDlAll");
}

function renderLibraryList() {
  if (!state.library) return;
  const isHe = settings.uiLang === "he";
  const dlSet = new Set(settings.downloaded.map((d) => d.title));
  let books;
  if (state.libCat === "DOWNLOADED") {
    const q = el.libSearch.value.trim().toLowerCase();
    books = settings.downloaded
      .map((d) => state.library.books.find((b) => b.title === d.title) || { title: d.title, heTitle: d.heTitle || d.title, categoryHe: "אופליין", category: "Offline", subPath: `${d.sections || ""}` })
      .filter((b) => !q || b.heTitle.toLowerCase().includes(q) || b.title.toLowerCase().includes(q));
  } else {
    books = searchLibrary(state.library.books, el.libSearch.value, state.libCat, 150);
  }
  if (!books.length) {
    el.libList.innerHTML = `<div class="empty">${state.libCat === "DOWNLOADED" ? escapeHtml(t("libEmptyDl")) : escapeHtml(t("libEmptySearch"))}</div>`;
    return;
  }
  el.libList.innerHTML = books
    .map((b) => {
      const done = dlSet.has(b.title);
      const primaryTitle = isHe ? b.heTitle : b.title;
      const secondary = isHe ? [b.categoryHe, b.subPath].filter(Boolean).join(" · ") : [b.heTitle, b.category].filter(Boolean).join(" · ");
      return `<button type="button" class="lib-card" data-title="${escapeHtml(b.title)}" data-he="${escapeHtml(b.heTitle)}">
        <div class="lib-card-top">
          <span class="lib-card-title">${escapeHtml(primaryTitle)}</span>
          ${done ? `<span class="lib-card-badge">${escapeHtml(t("libOfflineBadge"))}</span>` : ""}
        </div>
        <div class="lib-card-sub">${escapeHtml(secondary)}</div>
      </button>`;
    })
    .join("");
}

async function startBookDownload(title, heTitle) {
  if (state.dlAbort) {
    toast("הורדה אחרת כבר פעילה — בטל אותה תחילה");
    return;
  }
  const ac = new AbortController();
  state.dlAbort = ac;
  el.libProgress.hidden = false;
  el.libProgressFill.parentElement.classList.add("indeterminate");
  el.libProgressFill.style.width = "";
  el.libProgressText.textContent = `מתחיל הורדה: ${heTitle}…`;
  try {
    const res = await downloadBook(title, {
      includeLinks: el.libDlLinks.checked,
      signal: ac.signal,
      onProgress: ({ count, heRef }) => {
        el.libProgressText.textContent = `מוריד ${heTitle}: ${count} קטעים (${heRef})`;
      },
    });
    if (res.aborted) {
      toast(`ההורדה בוטלה (${res.count} קטעים נשמרו במטמון)`);
    } else {
      settings.downloaded = [
        { title, heTitle, sections: res.count },
        ...settings.downloaded.filter((d) => d.title !== title),
      ];
      save();
      toast(`הושלמה הורדת ${heTitle} (${res.count} קטעים)`);
    }
  } catch (e) {
    toast(`שגיאה בהורדה: ${e.message || e}`);
  } finally {
    state.dlAbort = null;
    el.libProgress.hidden = true;
    refreshCacheStats();
    renderLibraryCats();
    renderLibraryList();
  }
}

async function startFullLibraryDownload(overrideBooks = null, overrideLabel = null) {
  if (state.dlAbort) {
    toast("הורדה אחרת כבר פעילה — בטל אותה תחילה");
    return;
  }
  const books =
    overrideBooks ||
    (state.libCat !== "ALL" && state.libCat !== "DOWNLOADED"
      ? state.library?.books?.filter((b) => b.category === state.libCat)
      : state.library?.books);
  if (!books?.length) {
    toast("אינדקס הספרייה עדיין לא נטען");
    return;
  }
  const scopeLabel =
    overrideLabel ||
    (state.libCat !== "ALL" && state.libCat !== "DOWNLOADED"
      ? state.library.categories.find((c) => c.en === state.libCat)?.he || state.libCat
      : "כל המאגר");

  const ac = new AbortController();
  state.dlAbort = ac;
  el.libProgress.hidden = false;
  el.libProgressFill.parentElement.classList.remove("indeterminate");
  el.libProgressFill.style.width = "1%";
  el.libProgressText.textContent = `מוריד ${scopeLabel} (${books.length} ספרים) ישירות מ-CDN…`;

  const dlSet = new Set(settings.downloaded.map((d) => d.title));
  let dirty = false;
  let lastUi = 0;
  try {
    const res = await downloadBooksFast(books, {
      lang: settings.textLang,
      onProgress: (p) => {
        if (p.ok && !dlSet.has(p.title)) {
          dlSet.add(p.title);
          settings.downloaded.unshift({ title: p.title, heTitle: p.he_title });
          dirty = true;
        }
        const now = performance.now();
        if (now - lastUi > 120 || p.completed === p.total) {
          lastUi = now;
          const pct = Math.max(1, Math.round((p.completed / p.total) * 100));
          el.libProgressFill.style.width = `${pct}%`;
          el.libProgressText.textContent = `${scopeLabel}: ${p.completed}/${p.total} (${pct}%) · ${p.he_title}`;
          if (dirty) {
            save();
            dirty = false;
          }
        }
      },
    });
    if (dirty) save();
    if (res.aborted) {
      toast(`ההורדה נעצרה (${res.downloaded} ספרים חדשים נשמרו — ניתן להמשיך מאותה נקודה)`);
    } else {
      toast(`הושלמה הורדת ${scopeLabel}: ${res.downloaded} ספרים חדשים (${res.skipped} כבר במטמון)`);
    }
  } catch (e) {
    toast(`שגיאה בהורדה: ${e.message || e}`);
  } finally {
    state.dlAbort = null;
    el.libProgress.hidden = true;
    refreshCacheStats();
    renderLibraryCats();
    renderLibraryList();
  }
}

/* ───────────── Bookmarks & history ───────────── */
function renderLists() {
  const li = (loc) => `<li><button type="button" data-loc='${escapeHtml(JSON.stringify(loc))}'>${escapeHtml(locHe(loc))}</button></li>`;
  $("bookmarks-list").innerHTML = settings.bookmarks.length ? settings.bookmarks.map(li).join("") : `<li class="empty">אין סימניות</li>`;
  $("history-list").innerHTML = settings.history.length ? settings.history.map(li).join("") : `<li class="empty">—</li>`;
}

/* ───────────── Events ───────────── */
function bind() {
  el.tractate.onchange = () => navigate({ tractate: el.tractate.value, daf: 2, amud: "a" });
  el.daf.onchange = () => navigate({ tractate: state.loc?.tractate || el.tractate.value, daf: +el.daf.value, amud: "a" });
  el.amudA.onclick = () => navigate({ tractate: state.loc?.tractate || el.tractate.value, daf: state.loc?.daf || +el.daf.value || 2, amud: "a" });
  el.amudB.onclick = () => navigate({ tractate: state.loc?.tractate || el.tractate.value, daf: state.loc?.daf || +el.daf.value || 2, amud: "b" });
  el.prev.onclick = () => navigate(neighbor(-1));
  el.next.onclick = () => navigate(neighbor(1));

  el.searchForm.onsubmit = async (e) => {
    e.preventDefault();
    const q = el.search.value.trim();
    if (!q) return;
    const p = parseUserRef(q);
    if (p) {
      el.search.blur();
      return navigate(p, { segment: p.segment });
    }
    try {
      const res = await lookupName(q);
      const target = res?.is_ref && res.ref ? res.ref : res?.completions?.[0];
      if (target) {
        el.search.blur();
        return openRef(target);
      }
    } catch { /* offline or lookup failed */ }
    toast("לא זוהה מראה מקום. לדוגמה: ברכות ל״א ע״ב, בראשית א");
  };

  el.libraryBtn.onclick = () => openLibrary();
  el.libClose.onclick = () => el.libDialog.close();
  el.libDialog.addEventListener("click", (e) => { if (e.target === el.libDialog) el.libDialog.close(); });
  el.libSearch.oninput = () => renderLibraryList();
  el.libCats.addEventListener("click", (e) => {
    const c = e.target.closest("[data-cat]");
    if (!c) return;
    state.libCat = c.dataset.cat;
    renderLibraryCats();
    renderLibraryList();
  });
  el.libList.addEventListener("click", (e) => {
    const card = e.target.closest(".lib-card");
    if (!card) return;
    el.libDialog.close();
    navigate({ ref: card.dataset.title, heTitle: card.dataset.he });
  });
  el.libDlAll.onclick = () => startFullLibraryDownload();
  el.libDlCurrent.onclick = () => {
    const title = state.meta?.indexTitle || state.loc?.tractate;
    if (!title) return toast("אין ספר פתוח כרגע");
    const heTitle = state.meta?.heIndexTitle || (state.loc?.tractate ? tractateByEn(state.loc.tractate)?.he : locHe(state.loc)) || title;
    const match = state.library?.books?.find((b) => b.title === title);
    const categories = match?.categories || state.meta?.categories || [];
    if (categories.length) {
      startFullLibraryDownload([{ title, heTitle, categories }], heTitle);
    } else {
      startBookDownload(title, heTitle);
    }
  };
  el.libDlCancel.onclick = () => {
    state.dlAbort?.abort();
    cancelFastDownload();
  };

  el.dafyomi.onclick = async () => {
    try {
      const d = await getDafYomi();
      const p = d && parseUserRef(d.ref);
      if (!p) throw new Error();
      toast(`הדף היומי: ${d.he || d.ref}`);
      navigate(p);
    } catch { toast("לא ניתן לקבל את הדף היומי"); }
  };

  el.videoBtn.onclick = () => {
    settings.sidebar = true;
    settings.tab = "video";
    applySettings();
    renderTabs();
    loadVideo();
  };

  el.bookmark.onclick = () => {
    const i = settings.bookmarks.findIndex((b) => sameLoc(b, state.loc));
    if (i >= 0) settings.bookmarks.splice(i, 1);
    else settings.bookmarks.unshift(state.loc);
    save(); syncControls(); renderLists();
    toast(i >= 0 ? "הסימנייה הוסרה" : "נוספה סימנייה");
  };

  el.fontInc.onclick = () => zoom(1);
  el.fontDec.onclick = () => zoom(-1);
  el.sideToggle.onclick = () => { settings.sidebar = !settings.sidebar; applySettings(); };

  for (const [k, v] of [["fs-gemara", "fsGemara"], ["fs-comm", "fsComm"], ["fs-side", "fsSide"]]) {
    $(k).oninput = (e) => { settings[v] = +e.target.value; applySettings(); };
  }
  $("opt-ui-lang").onchange = (e) => {
    settings.uiLang = e.target.value;
    applySettings();
    buildTractateSelect();
    if (state.loc) syncControls();
    renderTabs();
    renderSidebar();
    renderLists();
    if (state.library) { renderLibraryCats(); renderLibraryList(); }
  };
  $("text-lang-ctl").onclick = (e) => {
    const b = e.target.closest("[data-tlang]");
    if (!b || b.dataset.tlang === settings.textLang) return;
    settings.textLang = b.dataset.tlang;
    applySettings();
    if (state.loc) loadAmud(state.loc, state.selected);
  };
  $("theme-ctl").onclick = (e) => { const t = e.target.closest("[data-theme]"); if (t) { settings.theme = t.dataset.theme; applySettings(); } };
  $("opt-nikud").onchange = (e) => { settings.nikud = e.target.checked; applySettings(); renderGemara(); };
  $("opt-rashi-font").onchange = (e) => { settings.rashiFont = e.target.checked; applySettings(); };
  $("opt-paras").onchange = (e) => { settings.paras = e.target.checked; applySettings(); };
  $("opt-marks").onchange = (e) => { settings.marks = e.target.checked; applySettings(); };
  $("opt-sync").onchange = (e) => { settings.sync = e.target.checked; applySettings(); };
  $("opt-daf-layout").onchange = (e) => { settings.dafLayout = e.target.checked; applySettings(); };
  $("clear-cache").onclick = async () => {
    const n = (await clearCache("sefaria")) + (await clearCache("video"));
    state.video.clear();
    settings.downloaded = [];
    save();
    toast(`נמחקו ${n} רשומות מהמטמון`);
  };
  document.querySelector("#settings-pop").addEventListener("click", (e) => {
    const b = e.target.closest("[data-loc]");
    if (b) { $("settings-pop").hidePopover(); navigate(JSON.parse(b.dataset.loc)); }
  });

  el.innerSel.onchange = () => {
    state.columns.inner = el.innerSel.value || null;
    settings.innerPref = state.grouped.commentators.find((c) => c.indexTitle === state.columns.inner)?.en || "";
    save(); loadColumn("inner"); renderTabs(); renderSidebar();
  };
  el.outerSel.onchange = () => {
    state.columns.outer = el.outerSel.value || null;
    settings.outerPref = state.grouped.commentators.find((c) => c.indexTitle === state.columns.outer)?.en || "";
    save(); loadColumn("outer"); renderTabs(); renderSidebar();
  };

  el.gemara.addEventListener("click", (e) => {
    const mark = e.target.closest(".mark");
    const seg = e.target.closest(".seg");
    const link = e.target.closest(".ref-link");
    if (link) return openRef(link.dataset.ref);
    if (!seg) return;
    if (mark) {
      settings.tab = mark.dataset.tab;
      settings.sidebar = true;
      applySettings();
      state.selected = null;
    }
    selectSegment(+seg.dataset.seg, "gemara");
  });
  el.gemara.addEventListener("scroll", onGemaraScroll, { passive: true });

  for (const body of [el.inner, el.outer]) {
    body.addEventListener("click", (e) => {
      const cm = e.target.closest(".cm");
      if (!cm) return;
      const seg = +cm.dataset.segs.split(" ")[0];
      if (seg) selectSegment(seg, "comm", cm);
    });
  }

  el.tabs.addEventListener("click", (e) => {
    const t = e.target.closest(".tab");
    if (!t) return;
    settings.tab = t.dataset.tab;
    save(); renderTabs(); renderSidebar();
  });
  el.filterClear.onclick = () => { state.selected = null; highlight(null); renderTabs(); renderSidebar(); };

  el.side.addEventListener("click", (e) => {
    const speed = e.target.closest("[data-speed]");
    if (speed) {
      const audio = $("yt-audio");
      if (audio) audio.playbackRate = +speed.dataset.speed;
      for (const b of speed.parentElement.children) b.classList.toggle("on", b === speed);
      return;
    }
    const vpick = e.target.closest("[data-vpick]");
    if (vpick) {
      const v = state.video.get(vkey(state.loc));
      if (v) {
        v.activeIdx = +vpick.dataset.vpick;
        renderVideo();
        onVideoAction("audio");
      }
      return;
    }
    const vact = e.target.closest("[data-vact]");
    if (vact) return onVideoAction(vact.dataset.vact);
    const chip = e.target.closest(".chip");
    if (chip) {
      const f = new Set(settings.commFilter);
      f.has(chip.dataset.comm) ? f.delete(chip.dataset.comm) : f.add(chip.dataset.comm);
      settings.commFilter = [...f];
      save(); return renderSidebar();
    }
    const act = e.target.closest("[data-act]");
    if (act) {
      const ref = act.closest(".item").dataset.ref;
      if (act.dataset.act === "sefaria") return openExternal(sefariaUrl(ref));
      if (act.dataset.act === "goto") return openRef(ref);
      if (act.dataset.act === "show") return selectSegment(+act.dataset.seg, "side");
    }
    const link = e.target.closest(".ref-link");
    if (link) return openRef(link.dataset.ref);
    const head = e.target.closest(".item-head");
    if (head) {
      const item = head.parentElement;
      const ref = item.dataset.ref;
      if (state.openItems.has(ref)) { state.openItems.delete(ref); item.classList.remove("open"); }
      else { state.openItems.add(ref); item.classList.add("open"); fillItem(item); }
    }
  });

  document.addEventListener("keydown", (e) => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
    if (e.ctrlKey && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoom(1); }
    else if (e.ctrlKey && e.key === "-") { e.preventDefault(); zoom(-1); }
    else if (e.ctrlKey && e.key === "0") { e.preventDefault(); zoom(0); }
    else if (e.ctrlKey && (e.key === "l" || e.key === "f")) { e.preventDefault(); el.search.focus(); el.search.select(); }
    else if (typing) return;
    else if (e.key === "ArrowLeft") { e.preventDefault(); navigate(neighbor(1)); }
    else if (e.key === "ArrowRight") { e.preventDefault(); navigate(neighbor(-1)); }
    else if (e.key === "Escape") { state.selected = null; highlight(null); renderTabs(); renderSidebar(); }
  });
}

function openRef(ref) {
  const p = parseSefariaRef(ref);
  if (p) return navigate(p, { segment: p.segment });
  return navigate({ ref });
}

/* ───────────── Boot ───────────── */
async function boot() {
  buildTractateSelect();
  bind();
  applySettings();
  let start = settings.last;
  if (!start) {
    try {
      const d = await getDafYomi();
      start = d && parseUserRef(d.ref);
    } catch { /* offline */ }
  }
  navigate(start || { tractate: "Berakhot", daf: 2, amud: "a" });
}

boot();
