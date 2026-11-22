import { describe, it, expect } from "vitest";
import { anchorSegments, groupLinks, defaultColumns, commentPosition, buildColumn, flattenText } from "./daf.js";

describe("anchorSegments", () => {
  it("extracts segments within the target amud and general Sefaria refs", () => {
    expect(
      anchorSegments({ anchorRef: "Berakhot 2a:3-5" }, "Berakhot 2a"),
    ).toEqual([3, 4, 5]);
    expect(
      anchorSegments({ anchorRefExpanded: ["Berakhot 2a:2", "Berakhot 2b:1"] }, "Berakhot 2a"),
    ).toEqual([2]);
    expect(
      anchorSegments({ anchorRef: "Genesis 1:1-3" }, "Genesis 1"),
    ).toEqual([1, 2, 3]);
    expect(commentPosition("Rashi on Genesis 1:3:2")).toEqual({ seg: 3, n: 2 });
  });
});

describe("groupLinks & defaultColumns", () => {
  it("classifies links, deduplicates, and picks Rashi/Tosafot defaults", () => {
    const raw = [
      { ref: "Rashi on Berakhot 2a:1:1", sourceHeRef: "רש״י ברכות ב.", category: "Commentary", index_title: "Rashi on Berakhot", collectiveTitle: { en: "Rashi", he: "רש״י" }, compDate: [1075], anchorRef: "Berakhot 2a:1" },
      { ref: "Rashi on Berakhot 2a:1:1", sourceHeRef: "רש״י ברכות ב.", category: "Commentary", index_title: "Rashi on Berakhot", collectiveTitle: { en: "Rashi", he: "רש״י" }, compDate: [1075], anchorRef: "Berakhot 2a:1" },
      { ref: "Tosafot on Berakhot 2a:1:1", sourceHeRef: "תוספות ברכות ב.", category: "Commentary", index_title: "Tosafot on Berakhot", collectiveTitle: { en: "Tosafot", he: "תוספות" }, compDate: [1200], anchorRef: "Berakhot 2a:1" },
      { ref: "Deuteronomy 6:7", sourceHeRef: "דברים ו׳:ז׳", category: "Tanakh", index_title: "Deuteronomy", anchorRef: "Berakhot 2a:1" },
      { ref: "Shabbat 9b:4", sourceHeRef: "שבת ט:", category: "Talmud", type: "mesorat hashas", index_title: "Shabbat", anchorRef: "Berakhot 2a:2" },
      { ref: "Mishneh Torah, Reading the Shema 1:9", sourceHeRef: "רמב״ם ק״ש א:ט", category: "Halakhah", type: "ein mishpat / ner mitzvah", index_title: "Mishneh Torah", anchorRef: "Berakhot 2a:1" },
    ];
    const g = groupLinks(raw, "Berakhot 2a");
    expect(g.links).toHaveLength(5);
    expect(g.groups.commentary).toHaveLength(2);
    expect(g.groups.torahOr).toHaveLength(1);
    expect(g.groups.mesorat).toHaveLength(1);
    expect(g.groups.einMishpat).toHaveLength(1);
    expect(g.bySegment.get(1)).toHaveLength(4);
    expect(defaultColumns(g.commentators)).toEqual({
      inner: "Rashi on Berakhot",
      outer: "Tosafot on Berakhot",
    });
  });
});

describe("buildColumn & flattenText", () => {
  it("maps commentary links to bulk nested text", () => {
    expect(commentPosition("Rashi on Berakhot 2a:3:2")).toEqual({ seg: 3, n: 2 });
    const links = [
      { ref: "Rashi on Berakhot 2a:1:1", heRef: "רש״י", segments: [1] },
      { ref: "Rashi on Berakhot 2a:2:1", heRef: "רש״י", segments: [2] },
    ];
    const bulk = [["א׳", "ב׳"], ["ג׳"]];
    const col = buildColumn(links, bulk);
    expect(col.map((c) => c.html)).toEqual(["א׳", "ג׳"]);
  });

  it("flattens arbitrarily nested text arrays", () => {
    expect(flattenText(["a", ["b", "", ["c"]], null])).toEqual(["a", "b", "c"]);
    expect(flattenText(null)).toEqual([]);
  });
});
