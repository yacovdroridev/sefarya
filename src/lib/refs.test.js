import { describe, it, expect } from "vitest";
import { TRACTATES, tractateByEn, matchTractatePrefix } from "./tractates.js";
import { parseSefariaRef, parseUserRef, locToRef, locToPath, hebrewAmud } from "./refs.js";

describe("tractates", () => {
  it("contains all 37 Bavli tractates", () => {
    expect(TRACTATES).toHaveLength(37);
  });

  it("looks up tractates case-insensitively", () => {
    expect(tractateByEn("berakhot")?.he).toBe("ברכות");
    expect(tractateByEn("Bava Batra")?.last).toBe(176);
    expect(tractateByEn("Unknown")).toBeNull();
  });

  it("matches longest tractate prefix", () => {
    expect(matchTractatePrefix("בבא בתרא יב")?.t.en).toBe("Bava Batra");
    expect(matchTractatePrefix("ראש השנה ב א")?.t.en).toBe("Rosh Hashanah");
    expect(matchTractatePrefix("berakhot 31b")?.t.en).toBe("Berakhot");
  });
});

describe("refs", () => {
  it("formats locations to Sefaria refs and paths", () => {
    const loc = { tractate: "Bava Batra", daf: 12, amud: "b" };
    expect(locToRef(loc)).toBe("Bava Batra 12b");
    expect(locToPath(loc)).toBe("Bava_Batra.12b");
    expect(hebrewAmud(loc)).toBe(":");
    expect(hebrewAmud({ ...loc, amud: "a" })).toBe(".");
  });

  it("parses Sefaria refs with optional segments", () => {
    expect(parseSefariaRef("Berakhot 2a")).toEqual({
      tractate: "Berakhot", daf: 2, amud: "a", segment: null, segmentEnd: null,
    });
    expect(parseSefariaRef("Bava_Metzia.21b:3-5")).toEqual({
      tractate: "Bava Metzia", daf: 21, amud: "b", segment: 3, segmentEnd: 5,
    });
    expect(parseSefariaRef("Genesis 1:1")).toBeNull();
  });

  it("parses free Hebrew and English user refs", () => {
    expect(parseUserRef("ברכות ל״א ע״ב")).toMatchObject({ tractate: "Berakhot", daf: 31, amud: "b" });
    expect(parseUserRef("ברכות ב.")).toMatchObject({ tractate: "Berakhot", daf: 2, amud: "a" });
    expect(parseUserRef("ברכות ב:")).toMatchObject({ tractate: "Berakhot", daf: 2, amud: "b" });
    expect(parseUserRef("ברכות דף טו עמוד ב")).toMatchObject({ tractate: "Berakhot", daf: 15, amud: "b" });
    expect(parseUserRef("Bava Batra 12")).toMatchObject({ tractate: "Bava Batra", daf: 12, amud: "a" });
    expect(parseUserRef("berakhot 31b")).toMatchObject({ tractate: "Berakhot", daf: 31, amud: "b" });
  });

  it("clamps out-of-range daf numbers and rejects unknown tractates", () => {
    expect(parseUserRef("ברכות 999")).toMatchObject({ tractate: "Berakhot", daf: 64, amud: "a" });
    expect(parseUserRef("ברכות 1")).toMatchObject({ tractate: "Berakhot", daf: 2, amud: "a" });
    expect(parseUserRef("לא קיים 5")).toBeNull();
  });
});
