//! Locating Daf Yomi video lessons on YouTube (Rabbi Udi Schwartz, Yeshivat Har Etzion)
//! via `yt-dlp` search. No API key required.
//!
//! Title formats observed in the channel:
//!   "דף יומי | מסכת ברכות | דף ל"א עמוד א"
//!   "הדף היומי | מסכת ערכין | דף ה' - הקדש וערך ..."
//!   "דף יומי | מסכת תמורה | הרב אודי שוורץ | דף ג: - ד:"
//!   "דף יומי | מסכת ברכות | דף כ"א - כ"ב"

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VideoHit {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedTitle {
    pub tractate: String,
    /// Inclusive amud range, amud index = daf*2 + (0 for a, 1 for b).
    pub start: u32,
    pub end: u32,
}

/// Remove punctuation/quotes/spaces so names and numerals compare loosely.
pub fn normalize_name(s: &str) -> String {
    s.chars()
        .filter(|c| ('\u{05D0}'..='\u{05EA}').contains(c))
        .collect()
}

fn letter_value(c: char) -> Option<u32> {
    Some(match c {
        'א' => 1, 'ב' => 2, 'ג' => 3, 'ד' => 4, 'ה' => 5, 'ו' => 6, 'ז' => 7, 'ח' => 8, 'ט' => 9,
        'י' => 10, 'כ' | 'ך' => 20, 'ל' => 30, 'מ' | 'ם' => 40, 'נ' | 'ן' => 50, 'ס' => 60,
        'ע' => 70, 'פ' | 'ף' => 80, 'צ' | 'ץ' => 90, 'ק' => 100, 'ר' => 200, 'ש' => 300, 'ת' => 400,
        _ => return None,
    })
}

/// Gematria of a Hebrew numeral token (ignores quotes/geresh). None if any non-letter Hebrew char.
pub fn gematria(token: &str) -> Option<u32> {
    let letters: Vec<char> = token
        .chars()
        .filter(|c| !matches!(c, '"' | '\'' | '״' | '׳' | '`' | '’' | '”'))
        .collect();
    if letters.is_empty() {
        return None;
    }
    let mut sum = 0;
    for c in letters {
        sum += letter_value(c)?;
    }
    Some(sum)
}

/// Converts a number to a Hebrew numeral (no punctuation), e.g. 15 -> "טו", 31 -> "לא".
pub fn to_hebrew_numeral(mut n: u32) -> String {
    let mut out = String::new();
    for (v, c) in [(400, 'ת'), (300, 'ש'), (200, 'ר'), (100, 'ק')] {
        while n >= v {
            out.push(c);
            n -= v;
        }
    }
    if n == 15 {
        out.push_str("טו");
        return out;
    }
    if n == 16 {
        out.push_str("טז");
        return out;
    }
    for (v, c) in [(90, 'צ'), (80, 'פ'), (70, 'ע'), (60, 'ס'), (50, 'נ'), (40, 'מ'), (30, 'ל'), (20, 'כ'), (10, 'י')] {
        if n >= v {
            out.push(c);
            n -= v;
        }
    }
    for (v, c) in [(9, 'ט'), (8, 'ח'), (7, 'ז'), (6, 'ו'), (5, 'ה'), (4, 'ד'), (3, 'ג'), (2, 'ב'), (1, 'א')] {
        if n >= v {
            out.push(c);
            n -= v;
        }
    }
    out
}

const MAX_DAF: u32 = 180;

/// Parses one "daf point": numeral token followed by optional amud marker.
/// Returns (daf, Option<amud 0|1>, rest_of_string).
fn parse_point(s: &str) -> Option<(u32, Option<u32>, &str)> {
    let s = s.trim_start();
    let end = s
        .char_indices()
        .find(|(_, c)| !(('\u{05D0}'..='\u{05EA}').contains(c) || matches!(c, '"' | '\'' | '״' | '׳' | '`' | '’' | '”')))
        .map(|(i, _)| i)
        .unwrap_or(s.len());
    let token = &s[..end];
    let daf = gematria(token)?;
    if daf < 2 || daf > MAX_DAF || normalize_name(token).chars().count() > 3 {
        return None;
    }
    let mut rest = &s[end..];
    let mut amud = None;
    let trimmed = rest.trim_start();
    if let Some(r) = trimmed.strip_prefix('.') {
        amud = Some(0);
        rest = r;
    } else if let Some(r) = trimmed.strip_prefix(':') {
        amud = Some(1);
        rest = r;
    } else if let Some(r) = trimmed.strip_prefix("עמוד") {
        let r2 = r.trim_start();
        if let Some(r3) = r2.strip_prefix('א') {
            amud = Some(0);
            rest = r3.trim_start_matches(|c| matches!(c, '\'' | '׳'));
        } else if let Some(r3) = r2.strip_prefix('ב') {
            amud = Some(1);
            rest = r3.trim_start_matches(|c| matches!(c, '\'' | '׳'));
        }
    } else if let Some(r) = trimmed.strip_prefix("ע\"א").or_else(|| trimmed.strip_prefix("ע״א")) {
        amud = Some(0);
        rest = r;
    } else if let Some(r) = trimmed.strip_prefix("ע\"ב").or_else(|| trimmed.strip_prefix("ע״ב")) {
        amud = Some(1);
        rest = r;
    }
    Some((daf, amud, rest))
}

pub fn parse_title(title: &str) -> Option<ParsedTitle> {
    let parts: Vec<&str> = title.split('|').map(|p| p.trim()).collect();
    let tractate = parts
        .iter()
        .find_map(|p| p.strip_prefix("מסכת").map(|t| t.trim().to_string()))?;
    let (d1, a1, rest) = parts.iter().find_map(|p| {
        if p.contains("יומי") {
            return None;
        }
        p.strip_prefix("דף").and_then(parse_point)
    })?;
    let start = d1 * 2 + a1.unwrap_or(0);
    let mut end = d1 * 2 + a1.unwrap_or(1);
    // Optional range: "- X" where X is a valid numeral greater than start.
    let rest_t = rest.trim_start();
    if let Some(after_dash) = rest_t.strip_prefix('-').or_else(|| rest_t.strip_prefix('–')) {
        let after_dash = after_dash.trim_start().trim_start_matches("דף").trim_start();
        if let Some((d2, a2, _)) = parse_point(after_dash) {
            let e = d2 * 2 + a2.unwrap_or(1);
            if d2 > d1 || (d2 == d1 && e > end) {
                end = e;
            }
        }
    }
    Some(ParsedTitle { tractate, start, end })
}

/// Score of how well a parsed title fits the requested amud (lower is better). None if it doesn't cover it.
pub fn match_score(p: &ParsedTitle, tractate_he: &str, daf: u32, amud: u32) -> Option<u32> {
    if normalize_name(&p.tractate) != normalize_name(tractate_he) {
        return None;
    }
    let idx = daf * 2 + amud;
    if idx < p.start || idx > p.end {
        return None;
    }
    Some(p.end - p.start)
}

pub fn pick_best(
    results: &[(String, String, String)],
    channel_filter: &str,
    tractate_he: &str,
    daf: u32,
    amud: u32,
) -> Option<VideoHit> {
    let mut best: Option<(u32, VideoHit)> = None;
    for (id, channel, title) in results {
        if !channel_filter.is_empty() && !channel.contains(channel_filter) {
            continue;
        }
        let Some(parsed) = parse_title(title) else { continue };
        let Some(score) = match_score(&parsed, tractate_he, daf, amud) else { continue };
        if best.as_ref().map_or(true, |(s, _)| score < *s) {
            best = Some((
                score,
                VideoHit {
                    id: id.clone(),
                    title: title.clone(),
                    channel: channel.clone(),
                    url: format!("https://www.youtube.com/watch?v={id}"),
                },
            ));
        }
    }
    best.map(|(_, h)| h)
}

pub async fn yt_search(query: &str, count: u32) -> Result<Vec<(String, String, String)>, String> {
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(40),
        tokio::process::Command::new("yt-dlp")
            .args([
                "--no-update",
                "--flat-playlist",
                "--no-warnings",
                "--print",
                "%(id)s\t%(channel)s\t%(title)s",
                &format!("ytsearch{count}:{query}"),
            ])
            .output(),
    )
    .await
    .map_err(|_| "yt-dlp timed out".to_string())?
    .map_err(|e| format!("לא ניתן להריץ yt-dlp ({e}). התקן: sudo apt install yt-dlp"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .lines()
        .filter_map(|l| {
            let mut it = l.splitn(3, '\t');
            Some((it.next()?.to_string(), it.next()?.to_string(), it.next()?.to_string()))
        })
        .collect())
}

/// Builds a YouTube search query for an audio lesson / reading of any Sefaria book section.
pub fn book_audio_query(section_he: &str, category: &str) -> String {
    let clean = section_he.trim();
    match category {
        "Tanakh" => format!("{clean} שיעור או קריאה"),
        "Mishnah" => format!("משנה יומית {clean}"),
        "Halakhah" => format!("שיעור {clean}"),
        _ => format!("שיעור {clean}"),
    }
}

/// Resolves a direct audio-only stream URL for a YouTube video ID via `yt-dlp`.
pub async fn yt_audio_url(id: &str) -> Result<String, String> {
    let url = format!("https://www.youtube.com/watch?v={id}");
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(25),
        tokio::process::Command::new("yt-dlp")
            .args([
                "--no-update",
                "--no-warnings",
                "-f",
                "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
                "-g",
                &url,
            ])
            .output(),
    )
    .await
    .map_err(|_| "yt-dlp audio timed out".to_string())?
    .map_err(|e| format!("לא ניתן להריץ yt-dlp ({e})"))?;

    let stream = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if stream.starts_with("http") {
        Ok(stream)
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("לא נמצא זרם שמע: {}", err.lines().next().unwrap_or("שגיאה")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numerals() {
        assert_eq!(gematria("ל\"א"), Some(31));
        assert_eq!(gematria("ט״ו"), Some(15));
        assert_eq!(gematria("ה'"), Some(5));
        assert_eq!(to_hebrew_numeral(15), "טו");
        assert_eq!(to_hebrew_numeral(16), "טז");
        assert_eq!(to_hebrew_numeral(31), "לא");
        assert_eq!(to_hebrew_numeral(176), "קעו");
    }

    #[test]
    fn parse_amud() {
        let p = parse_title("דף יומי | מסכת ברכות | דף ל\"א עמוד א").unwrap();
        assert_eq!(p.tractate, "ברכות");
        assert_eq!((p.start, p.end), (62, 62));
        let p = parse_title("דף יומי | מסכת ברכות | דף מ\"ז עמוד א'").unwrap();
        assert_eq!((p.start, p.end), (94, 94));
    }

    #[test]
    fn parse_whole_daf_with_topic() {
        let p = parse_title("הדף היומי | מסכת ערכין | דף ה' - הקדש וערך בדבר שהנשמה תלויה בו").unwrap();
        assert_eq!(p.tractate, "ערכין");
        assert_eq!((p.start, p.end), (10, 11));
    }

    #[test]
    fn parse_ranges() {
        let p = parse_title("דף יומי | מסכת ברכות | דף כ\"א - כ\"ב").unwrap();
        assert_eq!((p.start, p.end), (42, 45));
        let p = parse_title("דף יומי | מסכת תמורה | הרב אודי שוורץ | דף ג: - ד:").unwrap();
        assert_eq!(p.tractate, "תמורה");
        assert_eq!((p.start, p.end), (7, 9));
    }

    #[test]
    fn best_pick_prefers_narrow() {
        let ch = "ישיבת הר עציון - Yeshivat Har Etzion".to_string();
        let results = vec![
            ("wide".into(), ch.clone(), "דף יומי | מסכת ברכות | דף ל\"א".into()),
            ("narrow".into(), ch.clone(), "דף יומי | מסכת ברכות | דף ל\"א עמוד א".into()),
            ("other".into(), "Other".into(), "דף יומי | מסכת ברכות | דף ל\"א עמוד א".into()),
            ("wrong".into(), ch.clone(), "דף יומי | מסכת כתובות | דף ל\"א".into()),
        ];
        assert_eq!(pick_best(&results, "הר עציון", "ברכות", 31, 0).unwrap().id, "narrow");
        assert_eq!(pick_best(&results, "הר עציון", "ברכות", 31, 1).unwrap().id, "wide");
        assert!(pick_best(&results, "הר עציון", "ברכות", 32, 0).is_none());
    }

    #[test]
    fn audio_queries() {
        assert_eq!(book_audio_query("בראשית א׳", "Tanakh"), "בראשית א׳ שיעור או קריאה");
        assert_eq!(book_audio_query("משנה ברכות א׳", "Mishnah"), "משנה יומית משנה ברכות א׳");
        assert_eq!(book_audio_query("שולחן ערוך אורח חיים א׳", "Halakhah"), "שיעור שולחן ערוך אורח חיים א׳");
    }
}
