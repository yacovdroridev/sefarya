import { describe, it, expect } from "vitest";
import { flattenLibrary, searchLibrary, formatBytes, firstRefsFromIndex } from "./library.js";

const SAMPLE_TOC = [
  {
    category: "Tanakh",
    heCategory: "תנ״ך",
    contents: [
      {
        category: "Torah",
        heCategory: "תורה",
        contents: [
          { title: "Genesis", heTitle: "בראשית" },
          { title: "Exodus", heTitle: "שמות" },
        ],
      },
    ],
  },
  {
    category: "Halakhah",
    heCategory: "הלכה",
    contents: [
      { title: "Shulchan Arukh, Orach Chayim", heTitle: "שולחן ערוך אורח חיים" },
    ],
  },
];

describe("flattenLibrary", () => {
  it("flattens nested Sefaria categories and counts books", () => {
    const { categories, books } = flattenLibrary(SAMPLE_TOC);
    expect(categories).toEqual([
      { en: "Tanakh", he: "תנ״ך", count: 2 },
      { en: "Halakhah", he: "הלכה", count: 1 },
    ]);
    expect(books).toHaveLength(3);
    expect(books[0]).toMatchObject({
      title: "Genesis",
      heTitle: "בראשית",
      category: "Tanakh",
      subPath: "תורה",
    });
  });
});

describe("searchLibrary", () => {
  it("filters by category and ranks prefix matches first", () => {
    const { books } = flattenLibrary(SAMPLE_TOC);
    expect(searchLibrary(books, "בראש", "ALL").map((b) => b.title)).toEqual(["Genesis"]);
    expect(searchLibrary(books, "", "Halakhah").map((b) => b.title)).toEqual(["Shulchan Arukh, Orach Chayim"]);
    expect(searchLibrary(books, "שולחן", "Tanakh")).toEqual([]);
  });
});

describe("formatBytes", () => {
  it("formats bytes, KB, and MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("firstRefsFromIndex", () => {
  it("extracts leaf refs from complex Sefaria schema nodes", () => {
    const idx = {
      title: "Me'or Einayim",
      schema: {
        nodes: [
          { title: "Title" },
          { title: "Introduction" },
          { title: "Bereshit" },
        ],
      },
    };
    expect(firstRefsFromIndex(idx)).toEqual([
      "Me'or Einayim, Title",
      "Me'or Einayim, Introduction",
      "Me'or Einayim, Bereshit",
    ]);
  });

  it("handles nested schema nodes and default nodes", () => {
    const idx = {
      title: "Complex Book",
      schema: {
        nodes: [
          { title: "Part I", nodes: [{ title: "Intro" }, { default: true }] },
        ],
      },
    };
    expect(firstRefsFromIndex(idx)).toEqual([
      "Complex Book, Part I, Intro",
      "Complex Book, Part I",
    ]);
  });
});
