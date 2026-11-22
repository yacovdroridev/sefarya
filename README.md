# Sefarya (ספריא)

Linux desktop client for [Sefaria](https://www.sefaria.org) built with **Tauri 2 (Rust)** and vanilla JS/Vite.

## Features

- **Classic Vilna Daf layout**: Gemara with Rashi & Tosafot side-by-side (auto-swapping inner/outer columns on amud a/b), toggleable Rashi script (`Noto Rashi Hebrew` / `Frank Ruhl Libre`), nikud toggle, and synced scrolling.
- **Full Sefaria Library & Offline Cache**: Browse and open any book in Sefaria (Tanakh, Mishnah, Talmud, Halakhah, Midrash, Chasidut, Kabbalah, etc.) with local SQLite caching and resumable full-library / per-book offline download.
- **Apparatus & Commentaries**: Ein Mishpat, Torah Or, Mesorat HaShas, and additional commentaries (with Steinsaltz linked to the currently selected sentence).
- **YouTube Audio & Video Lessons**: Built-in audio-only player (with `1×`–`2×` speed controls) and video player via `yt-dlp` for Daf Yomi (Rabbi Udi Schwartz / Yeshivat Har Etzion) and all other Sefaria books.
- **Multi-language UI & Text**: Switch UI controls between Hebrew (`עברית`), English, French (`Français`), and Russian (`Русский`), and switch main text between Hebrew and English.

## Development

```bash
npm install
npm test
(cd src-tauri && cargo test)
npm run tauri dev
```

## Build Linux Package (`.deb`)

```bash
npx tauri build --bundles deb
sudo apt install ./src-tauri/target/release/bundle/deb/Sefarya_0.1.0_amd64.deb
```

## License

Code: MIT. Texts: Sefaria, per-version licenses.
