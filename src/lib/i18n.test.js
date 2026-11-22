import { describe, it, expect } from "vitest";
import { LANGS, langInfo, tr } from "./i18n.js";

describe("i18n", () => {
  it("supports Hebrew, English, French, and Russian with proper text directions", () => {
    expect(LANGS.map((l) => l.code)).toEqual(["he", "en", "fr", "ru"]);
    expect(langInfo("he").dir).toBe("rtl");
    expect(langInfo("en").dir).toBe("ltr");
    expect(langInfo("unknown").code).toBe("he");
  });

  it("translates static and parameterized keys", () => {
    expect(tr("en", "library")).toBe("Library");
    expect(tr("he", "library")).toBe("ספרייה");
    expect(tr("fr", "libDlAll")).toBe("Télécharger toute la bibliothèque");
    expect(tr("en", "filteredToLine", 4)).toBe("Filtered to line 4");
    expect(tr("he", "lineNo", 7)).toBe("שורה 7");
  });
});
