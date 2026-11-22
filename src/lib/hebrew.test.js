import { describe, it, expect } from "vitest";
import { gematria, toHebrewNumeral, stripNikud, escapeHtml, formatDibur } from "./hebrew.js";

describe("gematria", () => {
  it("parses simple and compound Hebrew numerals", () => {
    expect(gematria("ב")).toBe(2);
    expect(gematria("ב׳")).toBe(2);
    expect(gematria('ל"א')).toBe(31);
    expect(gematria("ט״ו")).toBe(15);
    expect(gematria("ט״ז")).toBe(16);
    expect(gematria("קע״ו")).toBe(176);
  });

  it("returns null for empty or non-Hebrew input", () => {
    expect(gematria("")).toBeNull();
    expect(gematria("123")).toBeNull();
    expect(gematria("abc")).toBeNull();
    expect(gematria("״׳")).toBeNull();
  });
});

describe("toHebrewNumeral", () => {
  it("formats numbers with gershayim/geresh by default", () => {
    expect(toHebrewNumeral(2)).toBe("ב׳");
    expect(toHebrewNumeral(15)).toBe("ט״ו");
    expect(toHebrewNumeral(16)).toBe("ט״ז");
    expect(toHebrewNumeral(31)).toBe("ל״א");
    expect(toHebrewNumeral(176)).toBe("קע״ו");
  });

  it("omits punctuation when punct=false", () => {
    expect(toHebrewNumeral(2, false)).toBe("ב");
    expect(toHebrewNumeral(15, false)).toBe("טו");
    expect(toHebrewNumeral(31, false)).toBe("לא");
  });
});

describe("stripNikud", () => {
  it("removes nikud and cantillation while keeping letters and maqaf", () => {
    expect(stripNikud("מֵאֵימָתַי קוֹרִין אֶת־שְׁמַע")).toBe("מאימתי קורין את־שמע");
  });
});

describe("escapeHtml", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<a href="x">&'test'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;test&#39;&lt;/a&gt;");
  });
});

describe("formatDibur", () => {
  it("bolds Vilna dibur hamatchil before dash", () => {
    expect(formatDibur("מאימתי – כלומר מאיזו שעה")).toBe('<b class="dh">מאימתי</b> כלומר מאיזו שעה');
    expect(formatDibur("מאימתי - כלומר מאיזו שעה")).toBe('<b class="dh">מאימתי</b> כלומר מאיזו שעה');
  });

  it("leaves already bolded or non-DH text unchanged", () => {
    expect(formatDibur("<b>מאימתי</b> – כלומר")).toBe("<b>מאימתי</b> – כלומר");
    expect(formatDibur("פירוש ללא דיבור המתחיל")).toBe("פירוש ללא דיבור המתחיל");
  });
});
