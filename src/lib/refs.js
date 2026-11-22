import { gematria } from "./hebrew.js";
import { matchTractatePrefix, tractateByEn } from "./tractates.js";

/** A daf location: { tractate: "Berakhot", daf: 2, amud: "a" } */
export function locToRef(loc) {
  return `${loc.tractate} ${loc.daf}${loc.amud}`;
}
export function locToPath(loc) {
  return `${loc.tractate.replace(/ /g, "_")}.${loc.daf}${loc.amud}`;
}

/** Parses Sefaria-style "Berakhot 2a" / "Berakhot 2a:5" / "Berakhot.2a". */
export function parseSefariaRef(ref) {
  const m = String(ref).replace(/_/g, " ").match(/^(.+?)[ .](\d+)([ab])(?::(\d+)(?:-(\d+))?)?$/);
  if (!m) return null;
  const t = tractateByEn(m[1]);
  if (!t) return null;
  return {
    tractate: t.en,
    daf: +m[2],
    amud: m[3],
    segment: m[4] ? +m[4] : null,
    segmentEnd: m[5] ? +m[5] : m[4] ? +m[4] : null,
  };
}

/**
 * Parses free user input in Hebrew or English:
 *   "ברכות ב א", "ברכות ב.", "ברכות דף ל״א ע״ב", "berakhot 31b", "Bava Batra 12"
 */
export function parseUserRef(input) {
  const s = String(input).trim();
  const direct = parseSefariaRef(s);
  if (direct) return direct;
  const pm = matchTractatePrefix(s);
  if (!pm) return null;
  // Drop the tractate name (by counting its letters in the original string).
  let need = pm.name.replace(/[^\u05D0-\u05EAa-z]/gi, "").length;
  let i = 0;
  while (i < s.length && need > 0) {
    if (/[\u05D0-\u05EAa-z]/i.test(s[i])) need--;
    i++;
  }
  let rest = s.slice(i).trim().replace(/^דף\s*/, "");
  let daf = null;
  let amud = "a";
  let m = rest.match(/^(\d+)\s*([ab.:])?/i);
  if (m) {
    daf = +m[1];
    if (m[2]) amud = /[b:]/i.test(m[2]) ? "b" : "a";
  } else {
    m = rest.match(/^([\u05D0-\u05EA"'״׳]+)\s*(.*)$/);
    if (m) {
      daf = gematria(m[1]);
      if (/^(:|ע["״]?ב|עמוד\s*ב|ב['׳]?(\s|$))/.test(m[2].trim())) amud = "b";
    }
  }
  if (!daf) daf = 2;
  if (daf < 2) daf = 2;
  if (daf > pm.t.last) daf = pm.t.last;
  return { tractate: pm.t.en, daf, amud, segment: null, segmentEnd: null };
}

export function hebrewAmud(loc) {
  return loc.amud === "a" ? "." : ":";
}
