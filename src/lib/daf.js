// Pure data shaping for a single amud: groups Sefaria links into the classic "daf" apparatus.

export const CATEGORY_HE = {
  Commentary: "פרשנות",
  "Quoting Commentary": "מצטטים",
  Halakhah: "הלכה",
  Tanakh: "תנ״ך",
  Talmud: "תלמוד",
  Mishnah: "משנה",
  Midrash: "מדרש",
  Musar: "מוסר",
  Chasidut: "חסידות",
  "Jewish Thought": "מחשבה",
  Kabbalah: "קבלה",
  Responsa: "שו״ת",
  Liturgy: "תפילה",
  Reference: "מילונים",
  Tosefta: "תוספתא",
  "Second Temple": "בית שני",
  Modern: "מודרני",
};

export const PRIMARY_INNER = ["Rashi", "Rashbam", "Ran", "Rabbeinu Gershom"];
export const PRIMARY_OUTER = ["Tosafot"];

/** Extract the segment numbers a link anchors to (only within the given section ref). */
export function anchorSegments(link, sectionRef) {
  const out = new Set();
  const list = link.anchorRefExpanded?.length ? link.anchorRefExpanded : [link.anchorRef];
  const prefix = `${sectionRef}:`;
  for (const r of list) {
    if (!r || !r.startsWith(prefix)) continue;
    const tail = r.slice(prefix.length);
    const m = tail.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = +m[1];
    const b = m[2] ? +m[2] : a;
    for (let i = a; i <= b; i++) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}

export function normalizeLink(link, dafRef) {
  return {
    ref: link.ref || link.sourceRef,
    heRef: link.sourceHeRef || link.ref,
    category: link.category || "",
    type: link.type || "",
    title: link.collectiveTitle?.he || link.heTitle || link.index_title,
    titleEn: link.collectiveTitle?.en || link.index_title,
    indexTitle: link.index_title,
    order: link.commentaryNum ?? 0,
    compDate: Array.isArray(link.compDate) ? link.compDate[0] : link.compDate ?? 9999,
    segments: anchorSegments(link, dafRef),
  };
}

export function classify(l) {
  if (/ein mishpat/i.test(l.type)) return "einMishpat";
  if (l.category === "Tanakh") return "torahOr";
  if (l.category === "Talmud" || /mesorat hashas/i.test(l.type)) return "mesorat";
  if (l.category === "Commentary") return "commentary";
  if (l.category === "Halakhah") return "halakha";
  return "other";
}

const sortLinks = (a, b) =>
  (a.segments[0] ?? 0) - (b.segments[0] ?? 0) || a.order - b.order || a.ref.localeCompare(b.ref);

/**
 * Groups raw /api/links results for one amud.
 * @returns {{
 *   links: object[],
 *   groups: Record<string, object[]>,
 *   commentators: {indexTitle:string, he:string, en:string, count:number, compDate:number}[],
 *   bySegment: Map<number, object[]>
 * }}
 */
export function groupLinks(rawLinks, dafRef) {
  const seen = new Set();
  const links = [];
  for (const raw of rawLinks || []) {
    const l = normalizeLink(raw, dafRef);
    if (!l.ref || seen.has(l.ref)) continue;
    seen.add(l.ref);
    l.kind = classify(l);
    links.push(l);
  }
  links.sort(sortLinks);

  const groups = { einMishpat: [], torahOr: [], mesorat: [], halakha: [], commentary: [], other: [] };
  const bySegment = new Map();
  const comm = new Map();
  for (const l of links) {
    groups[l.kind].push(l);
    for (const s of l.segments) {
      if (!bySegment.has(s)) bySegment.set(s, []);
      bySegment.get(s).push(l);
    }
    if (l.kind === "commentary") {
      const c = comm.get(l.indexTitle) || { indexTitle: l.indexTitle, he: l.title, en: l.titleEn, count: 0, compDate: l.compDate };
      c.count++;
      comm.set(l.indexTitle, c);
    }
  }
  const commentators = [...comm.values()].sort((a, b) => a.compDate - b.compDate || b.count - a.count);
  return { links, groups, commentators, bySegment };
}

/** Picks default inner (Rashi-like) and outer (Tosafot-like) commentators for any section. */
export function defaultColumns(commentators) {
  const find = (names) => {
    for (const n of names) {
      const c = commentators.find((c) => c.en === n);
      if (c) return c.indexTitle;
    }
    return null;
  };
  let inner = find(PRIMARY_INNER);
  let outer = find(PRIMARY_OUTER);
  if (!inner && commentators.length) inner = commentators[0].indexTitle;
  if (!outer) {
    const second = commentators.find((c) => c.indexTitle !== inner);
    if (second) outer = second.indexTitle;
  }
  return { inner, outer };
}

/** Parses "Rashi on Berakhot 2a:3:2" or "Rashi on Genesis 1:3:2" → { seg: 3, n: 2 }. */
export function commentPosition(ref) {
  const m = ref.match(/ (?:\d+[ab]|\d+):(\d+):(\d+)(?:-\d+)?$/);
  return m ? { seg: +m[1], n: +m[2] } : null;
}

/**
 * Builds the commentary column for one commentator.
 * @param links normalized commentary links of this commentator
 * @param bulkText nested array from v3 texts of "<indexTitle> <daf>" (text[seg-1][n-1]) or null
 * @returns {{ref, heRef, segments:number[], html:string|null}[]}
 */
export function buildColumn(links, bulkText) {
  return links.map((l) => {
    const pos = commentPosition(l.ref);
    let html = null;
    if (pos && Array.isArray(bulkText)) {
      const seg = bulkText[pos.seg - 1];
      html = Array.isArray(seg) ? seg[pos.n - 1] ?? null : pos.n === 1 && typeof seg === "string" ? seg : null;
    }
    return { ref: l.ref, heRef: l.heRef, segments: l.segments, html };
  });
}

/** Flattens a (possibly nested) v3 text into an array of strings. */
export function flattenText(t) {
  if (t == null) return [];
  if (typeof t === "string") return t ? [t] : [];
  return t.flatMap(flattenText);
}
