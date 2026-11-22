// Pure helpers for browsing and searching the full Sefaria library (/api/index).

export const LIBRARY_CAT_HE = {
  Tanakh: "תנ״ך",
  Mishnah: "משנה",
  Talmud: "תלמוד",
  Midrash: "מדרש",
  Halakhah: "הלכה",
  Kabbalah: "קבלה",
  Liturgy: "תפילה",
  "Jewish Thought": "מחשבת ישראל",
  Tosefta: "תוספתא",
  Chasidut: "חסידות",
  Musar: "מוסר",
  Responsa: "שו״ת",
  "Second Temple": "בית שני",
  Reference: "מילונים",
};

/**
 * Flattens Sefaria's recursive /api/index tree into top-level categories and a flat book list.
 */
export function flattenLibrary(toc) {
  const books = [];
  const catCounts = new Map();

  const walk = (nodes, topCat, topCatHe, path, pathHe) => {
    for (const node of nodes || []) {
      if (node.contents) {
        const cat = topCat || node.category || "";
        const catHe = topCatHe || node.heCategory || LIBRARY_CAT_HE[cat] || cat;
        const nextPath = topCat ? [...path, node.category || ""] : [];
        const nextPathHe = topCat ? [...pathHe, node.heCategory || node.category || ""] : [];
        walk(node.contents, cat, catHe, nextPath, nextPathHe);
      } else if (node.title) {
        const cat = topCat || node.categories?.[0] || "Other";
        const catHe = topCatHe || LIBRARY_CAT_HE[cat] || cat;
        books.push({
          title: node.title,
          heTitle: node.heTitle || node.title,
          category: cat,
          categoryHe: catHe,
          subPath: pathHe.filter(Boolean).join(" › "),
          order: node.order ?? 9999,
        });
        catCounts.set(cat, {
          en: cat,
          he: catHe,
          count: (catCounts.get(cat)?.count || 0) + 1,
        });
      }
    }
  };

  walk(toc, null, null, [], []);
  const categories = [...catCounts.values()];
  return { categories, books };
}

/**
 * Searches flattened library books by Hebrew or English title/category.
 */
export function searchLibrary(books, query, category = "ALL", limit = 120) {
  const q = String(query || "").trim().toLowerCase();
  const pool = category && category !== "ALL" ? books.filter((b) => b.category === category) : books;
  if (!q) return pool.slice(0, limit);

  const exact = [];
  const starts = [];
  const includes = [];
  for (const b of pool) {
    const he = b.heTitle.toLowerCase();
    const en = b.title.toLowerCase();
    const sub = b.subPath.toLowerCase();
    if (he === q || en === q) exact.push(b);
    else if (he.startsWith(q) || en.startsWith(q)) starts.push(b);
    else if (he.includes(q) || en.includes(q) || sub.includes(q)) includes.push(b);
  }
  return [...exact, ...starts, ...includes].slice(0, limit);
}

/** Formats byte size into a compact human-readable label. */
export function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Extracts candidate starting section refs for a complex Sefaria book from its /api/v2/index/<title> schema.
 */
export function firstRefsFromIndex(indexData, limit = 5) {
  if (!indexData) return [];
  const out = [];
  if (indexData.first_section_ref) out.push(indexData.first_section_ref);
  const rootTitle = indexData.title || indexData.schema?.title || "";
  const walk = (nodes, prefix) => {
    for (const n of nodes || []) {
      if (out.length >= limit) return;
      const seg = n.default ? "" : n.title || (n.key && n.key !== "default" ? n.key : "");
      const nextPrefix = seg ? (prefix ? `${prefix}, ${seg}` : seg) : prefix;
      if (Array.isArray(n.nodes) && n.nodes.length) {
        walk(n.nodes, nextPrefix);
      } else if (nextPrefix && !out.includes(nextPrefix)) {
        out.push(nextPrefix);
      }
    }
  };
  walk(indexData.schema?.nodes, rootTitle);
  return out;
}
