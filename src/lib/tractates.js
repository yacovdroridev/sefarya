// Babylonian Talmud tractates as named on Sefaria, with Hebrew names and last daf (Vilna).
export const SEDARIM = [
  { he: "זרעים", tractates: [["Berakhot", "ברכות", 64]] },
  {
    he: "מועד",
    tractates: [
      ["Shabbat", "שבת", 157],
      ["Eruvin", "עירובין", 105],
      ["Pesachim", "פסחים", 121],
      ["Shekalim", "שקלים", 22],
      ["Yoma", "יומא", 88],
      ["Sukkah", "סוכה", 56],
      ["Beitzah", "ביצה", 40],
      ["Rosh Hashanah", "ראש השנה", 35],
      ["Taanit", "תענית", 31],
      ["Megillah", "מגילה", 32],
      ["Moed Katan", "מועד קטן", 29],
      ["Chagigah", "חגיגה", 27],
    ],
  },
  {
    he: "נשים",
    tractates: [
      ["Yevamot", "יבמות", 122],
      ["Ketubot", "כתובות", 112],
      ["Nedarim", "נדרים", 91],
      ["Nazir", "נזיר", 66],
      ["Sotah", "סוטה", 49],
      ["Gittin", "גיטין", 90],
      ["Kiddushin", "קידושין", 82],
    ],
  },
  {
    he: "נזיקין",
    tractates: [
      ["Bava Kamma", "בבא קמא", 119],
      ["Bava Metzia", "בבא מציעא", 119],
      ["Bava Batra", "בבא בתרא", 176],
      ["Sanhedrin", "סנהדרין", 113],
      ["Makkot", "מכות", 24],
      ["Shevuot", "שבועות", 49],
      ["Avodah Zarah", "עבודה זרה", 76],
      ["Horayot", "הוריות", 14],
    ],
  },
  {
    he: "קדשים",
    tractates: [
      ["Zevachim", "זבחים", 120],
      ["Menachot", "מנחות", 110],
      ["Chullin", "חולין", 142],
      ["Bekhorot", "בכורות", 61],
      ["Arakhin", "ערכין", 34],
      ["Temurah", "תמורה", 34],
      ["Keritot", "כריתות", 28],
      ["Meilah", "מעילה", 22],
    ],
  },
  { he: "טהרות", tractates: [["Niddah", "נדה", 73]] },
];

export const TRACTATES = SEDARIM.flatMap((s) =>
  s.tractates.map(([en, he, last]) => ({ en, he, last, seder: s.he })),
);

const byEn = new Map(TRACTATES.map((t) => [t.en.toLowerCase(), t]));

export function tractateByEn(en) {
  return byEn.get(String(en).toLowerCase()) || null;
}

const strip = (s) => s.replace(/[^\u05D0-\u05EAa-z]/gi, "").toLowerCase();

/** Finds the tractate whose name is a prefix of the (normalized) string. Longest match wins. */
export function matchTractatePrefix(text) {
  const n = strip(text);
  let best = null;
  for (const t of TRACTATES) {
    for (const name of [t.he, t.en]) {
      const k = strip(name);
      if (n.startsWith(k) && (!best || k.length > best.len)) best = { t, len: k.length, name };
    }
  }
  return best;
}
