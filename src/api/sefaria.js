import { invoke } from "@tauri-apps/api/core";
import { flattenText } from "../lib/daf.js";
import { firstRefsFromIndex } from "../lib/library.js";

const isTauri = () => typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

/** GET a Sefaria API path. Uses the Rust cache in Tauri; falls back to fetch in a plain browser. */
export async function sefariaGet(path, { maxAge = null } = {}) {
  if (isTauri()) {
    const r = await invoke("sefaria_get", { path, maxAgeSecs: maxAge });
    const data = JSON.parse(r.body);
    if (data && data.error) throw new Error(data.error);
    return { data, fromCache: r.from_cache, stale: r.stale };
  }
  const res = await fetch(`https://www.sefaria.org/api/${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data && data.error) throw new Error(data.error);
  return { data, fromCache: false, stale: false };
}

const enc = (ref) => encodeURIComponent(ref.replace(/ /g, "_")).replace(/%3A/g, ":");

async function fetchTextDirect(ref, lang = "hebrew") {
  let { data, stale } = await sefariaGet(`v3/texts/${enc(ref)}?version=${lang}`);
  let v = data.versions?.[0];
  if (!v || flattenText(v.text).length === 0) {
    ({ data, stale } = await sefariaGet(`v3/texts/${enc(ref)}?version=primary`));
    v = data.versions?.[0];
  }
  return {
    meta: data,
    text: v?.text ?? [],
    versionTitle: v?.versionTitleInHebrew || v?.versionTitle || "",
    license: v?.license || "",
    direction: v?.direction || (v?.language === "en" ? "ltr" : "rtl"),
    stale,
  };
}

/** Fetch a text section (Hebrew preferred). Automatically resolves complex books via /api/v2/index. */
export async function getText(ref, lang = "hebrew") {
  try {
    return await fetchTextDirect(ref, lang);
  } catch (origErr) {
    // Complex Sefaria texts (e.g. Me'or Einayim, Tanya) return 400 on bare book title;
    // look up the book schema and open its first real section node.
    try {
      const { data: idx } = await sefariaGet(`v2/index/${enc(ref)}`, { maxAge: 7 * 86400 });
      const candidates = firstRefsFromIndex(idx, 6);
      for (const c of candidates) {
        if (c === ref) continue;
        try {
          const res = await fetchTextDirect(c, lang);
          if (flattenText(res.text).length > 0) return res;
        } catch { /* try next candidate */ }
      }
      if (candidates[0] && candidates[0] !== ref) {
        return await fetchTextDirect(candidates[0], lang);
      }
    } catch { /* not a bare complex index title */ }
    throw origErr;
  }
}

export async function getLinks(ref) {
  const { data } = await sefariaGet(`links/${enc(ref)}?with_text=0`);
  return Array.isArray(data) ? data : [];
}

export async function getDafYomi() {
  const { data } = await sefariaGet("calendars", { maxAge: 6 * 3600 });
  const item = data.calendar_items?.find((i) => i.title?.en === "Daf Yomi");
  return item ? { ref: item.ref, he: item.displayValue?.he } : null;
}

export async function findVideo(tractateHe, daf, amud, force = false) {
  if (!isTauri()) {
    const q = `דף יומי מסכת ${tractateHe} דף ${daf} הרב אודי שוורץ`;
    return { hit: null, search_url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` };
  }
  return invoke("find_video", { tractateHe, daf, amud: amud === "b" ? 1 : 0, force });
}

export async function findBookAudio(sectionHe, category = "", force = false) {
  if (!isTauri()) {
    const q = `שיעור ${sectionHe}`;
    return { hits: [], search_url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` };
  }
  return invoke("find_book_audio", { sectionHe, category, force });
}

export async function getAudioStream(id) {
  if (!isTauri()) throw new Error("זמין בגרסת שולחן העבודה");
  return invoke("get_audio_stream", { id });
}

export async function openExternal(url) {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    return openUrl(url);
  }
  window.open(url, "_blank");
}

export async function openVideoWindow(id, title) {
  if (isTauri()) return invoke("open_video_window", { id, title });
  window.open(`https://www.youtube.com/watch?v=${id}`, "_blank");
}

export async function clearCache(ns) {
  if (isTauri()) return invoke("clear_cache", { ns });
  return 0;
}

export async function getCacheStats() {
  if (isTauri()) return invoke("cache_stats");
  return { sefaria_count: 0, video_count: 0, db_bytes: 0 };
}

export async function getLibraryIndex() {
  const { data } = await sefariaGet("index", { maxAge: 7 * 86400 });
  return Array.isArray(data) ? data : [];
}

export async function lookupName(query) {
  const { data } = await sefariaGet(`name/${encodeURIComponent(query)}?limit=10`, { maxAge: 86400 });
  return data;
}

/**
 * Downloads an entire book into the local SQLite cache by walking `meta.next` from `startRef`.
 * Already-cached sections are served instantly from SQLite, so resuming is fast.
 */
export async function downloadBook(startRef, { includeLinks = true, onProgress, signal } = {}) {
  let ref = startRef;
  let bookTitle = null;
  let count = 0;
  const visited = new Set();

  while (ref && !visited.has(ref)) {
    if (signal?.aborted) return { count, aborted: true };
    visited.add(ref);
    const t = await getText(ref);
    const meta = t.meta || {};
    const curTitle = meta.indexTitle || meta.book;
    if (!bookTitle) bookTitle = curTitle;
    else if (curTitle && curTitle !== bookTitle) break;

    const sectionRef = meta.sectionRef || meta.ref || ref;
    if (includeLinks) {
      await getLinks(sectionRef).catch(() => []);
    }
    count++;
    onProgress?.({ count, ref: sectionRef, heRef: meta.heRef || sectionRef, done: false });

    const next = meta.next;
    if (!next || visited.has(next)) break;
    ref = next;
  }
  onProgress?.({ count, ref, heRef: "", done: true });
  return { count, aborted: false };
}

/**
 * Resumably downloads a list of books (e.g. the full Sefaria library or a category) into SQLite.
 * Skips books in `skipTitles` and saves progress incrementally via `onBookDone`.
 */
export async function downloadLibrary(books, { includeLinks = false, skipTitles = new Set(), onProgress, onBookDone, signal } = {}) {
  let completedBooks = 0;
  let totalSections = 0;
  let errors = 0;
  const total = books.length;

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) return { completedBooks, totalSections, errors, aborted: true };
    const book = books[i];
    if (skipTitles.has(book.title)) {
      completedBooks++;
      onProgress?.({ bookIndex: i + 1, totalBooks: total, book, sections: 0, totalSections, heRef: "כבר במטמון" });
      continue;
    }
    try {
      const res = await downloadBook(book.title, {
        includeLinks,
        signal,
        onProgress: ({ count, heRef }) => {
          onProgress?.({ bookIndex: i + 1, totalBooks: total, book, sections: count, totalSections: totalSections + count, heRef });
        },
      });
      totalSections += res.count;
      if (res.aborted) return { completedBooks, totalSections, errors, aborted: true };
      completedBooks++;
      onBookDone?.(book, res.count);
    } catch {
      errors++;
    }
  }
  return { completedBooks, totalSections, errors, aborted: false };
}

export function sefariaUrl(ref) {
  return `https://www.sefaria.org/${enc(ref)}?lang=he`;
}
