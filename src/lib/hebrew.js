const VALUES = {
  א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ך: 20, ל: 30,
  מ: 40, ם: 40, נ: 50, ן: 50, ס: 60, ע: 70, פ: 80, ף: 80, צ: 90, ץ: 90, ק: 100, ר: 200,
  ש: 300, ת: 400,
};

export function gematria(token) {
  let sum = 0;
  let any = false;
  for (const c of token) {
    if (`"'״׳`.includes(c)) continue;
    const v = VALUES[c];
    if (!v) return null;
    sum += v;
    any = true;
  }
  return any ? sum : null;
}

export function toHebrewNumeral(n, punct = true) {
  let out = "";
  for (const [v, c] of [[400, "ת"], [300, "ש"], [200, "ר"], [100, "ק"]]) {
    while (n >= v) { out += c; n -= v; }
  }
  if (n === 15) out += "טו";
  else if (n === 16) out += "טז";
  else {
    for (const [v, c] of [[90, "צ"], [80, "פ"], [70, "ע"], [60, "ס"], [50, "נ"], [40, "מ"], [30, "ל"], [20, "כ"], [10, "י"]]) {
      if (n >= v) { out += c; n -= v; }
    }
    for (const [v, c] of [[9, "ט"], [8, "ח"], [7, "ז"], [6, "ו"], [5, "ה"], [4, "ד"], [3, "ג"], [2, "ב"], [1, "א"]]) {
      if (n >= v) { out += c; n -= v; }
    }
  }
  if (!punct) return out;
  return out.length === 1 ? out + "׳" : out.slice(0, -1) + "״" + out.slice(-1);
}

// Hebrew points & cantillation; keeps maqaf (05BE), paseq (05C0), sof pasuq (05C3).
const NIKUD_RE = /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g;
export function stripNikud(s) {
  return s.replace(NIKUD_RE, "");
}

const ALLOWED = new Set(["B", "STRONG", "BIG", "SMALL", "I", "EM", "BR", "SPAN", "SUP", "SUB", "A", "U", "P"]);

/** Minimal HTML sanitizer for Sefaria text: keeps formatting tags and ref links, drops everything else. */
export function sanitize(html, doc = globalThis.document) {
  const tpl = doc.createElement("template");
  tpl.innerHTML = html ?? "";
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 1) {
        if (!ALLOWED.has(child.tagName)) {
          // Footnotes (<i class="footnote">) are dropped entirely; other tags are unwrapped.
          if (child.tagName === "SCRIPT" || child.tagName === "STYLE") { child.remove(); continue; }
          walk(child);
          child.replaceWith(...child.childNodes);
          continue;
        }
        if (child.tagName === "I" && child.classList.contains("footnote")) { child.remove(); continue; }
        if (child.tagName === "SUP" && child.classList.contains("footnote-marker")) { child.remove(); continue; }
        const ref = child.getAttribute("data-ref");
        for (const a of [...child.attributes]) child.removeAttribute(a.name);
        if (child.tagName === "A") {
          if (ref) { child.setAttribute("data-ref", ref); child.className = "ref-link"; }
          else { child.replaceWith(...child.childNodes); continue; }
        }
        walk(child);
      }
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Splits "dibur hamatchil – explanation" (Rashi/Tosafot Vilna format) into bold DH + rest. */
export function formatDibur(html) {
  const m = html.match(/^(.{1,220}?)\s[–-]\s/);
  if (!m || /<b>|<strong>/.test(m[1])) return html;
  return `<b class="dh">${m[1]}</b> ${html.slice(m[0].length)}`;
}
