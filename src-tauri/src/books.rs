//! Fast bulk offline library downloader & local section reader using Sefaria's public
//! Google Cloud Storage export (`https://storage.googleapis.com/sefaria-export/json/.../merged.json`).
//! Downloads an entire book in ONE HTTP/2 request (~0.2s) instead of hundreds of per-chapter API calls.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const GCS_BASE: &str = "https://storage.googleapis.com/sefaria-export/json";

#[derive(Debug, Clone, Deserialize)]
pub struct BookDownloadSpec {
    pub title: String,
    pub he_title: String,
    pub categories: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FastDownloadProgress {
    pub completed: usize,
    pub total: usize,
    pub title: String,
    pub he_title: String,
    pub skipped: bool,
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FastDownloadResult {
    pub completed: usize,
    pub downloaded: usize,
    pub skipped: usize,
    pub failed: usize,
    pub aborted: bool,
}

/// Builds the Google Cloud Storage `merged.json` URL for a Sefaria book.
pub fn gcs_merged_url(categories: &[String], title: &str, lang_dir: &str) -> String {
    let mut parts: Vec<String> = Vec::with_capacity(categories.len() + 3);
    for c in categories {
        if !c.is_empty() {
            parts.push(urlencoding::encode(c).into_owned());
        }
    }
    parts.push(urlencoding::encode(title).into_owned());
    parts.push(lang_dir.to_string());
    parts.push("merged.json".to_string());
    format!("{GCS_BASE}/{}", parts.join("/"))
}

/// Parses a `v3/texts/<encoded_ref>?version=<lang>` path into `(decoded_ref, lang_dir)`.
pub fn parse_text_api_path(path: &str) -> Option<(String, &'static str)> {
    let rest = path.strip_prefix("v3/texts/")?;
    let (raw_ref, query) = rest.split_once('?').unwrap_or((rest, ""));
    let decoded = urlencoding::decode(raw_ref).ok()?.replace('_', " ");
    let lang_dir = if query.contains("version=english") {
        "English"
    } else {
        "Hebrew"
    };
    Some((decoded, lang_dir))
}

/// Splits a Sefaria ref into `(book_title, section_part)`.
/// Examples:
///   "Berakhot 2a" -> ("Berakhot", Some("2a"))
///   "Genesis 1" -> ("Genesis", Some("1"))
///   "Me'or Einayim, Bereshit" -> ("Me'or Einayim", Some("Bereshit"))
///   "Genesis" -> ("Genesis", None)
pub fn split_ref(ref_str: &str) -> (&str, Option<&str>) {
    let s = ref_str.trim();
    if let Some((book, rest)) = s.split_once(", ") {
        // Complex book sub-node (only if the book isn't e.g. "Shulchan Arukh, Orach Chayim 1")
        if let Some((head, tail)) = s.rsplit_once(' ') {
            if is_section_token(tail) {
                return (head, Some(tail));
            }
        }
        return (book, Some(rest));
    }
    if let Some((head, tail)) = s.rsplit_once(' ') {
        if is_section_token(tail) {
            return (head, Some(tail));
        }
    }
    (s, None)
}

fn is_section_token(tok: &str) -> bool {
    if tok.is_empty() {
        return false;
    }
    let bytes = tok.as_bytes();
    let last = bytes[bytes.len() - 1];
    if (last == b'a' || last == b'b') && bytes.len() >= 2 {
        return bytes[..bytes.len() - 1].iter().all(|b| b.is_ascii_digit());
    }
    tok.split(':').all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
}

fn daf_to_idx(tok: &str) -> Option<usize> {
    let b = tok.as_bytes();
    if b.len() < 2 {
        return None;
    }
    let last = b[b.len() - 1];
    let amud = match last {
        b'a' => 0usize,
        b'b' => 1usize,
        _ => return None,
    };
    let daf: usize = tok[..tok.len() - 1].parse().ok()?;
    if daf < 1 {
        return None;
    }
    Some((daf - 1) * 2 + amud)
}

fn idx_to_daf(idx: usize) -> String {
    let daf = idx / 2 + 1;
    let amud = if idx % 2 == 0 { 'a' } else { 'b' };
    format!("{daf}{amud}")
}

fn is_non_empty(v: &Value) -> bool {
    match v {
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => a.iter().any(is_non_empty),
        Value::Object(m) => m.values().any(is_non_empty),
        _ => false,
    }
}

/// Extracts a single section from a cached `merged.json` string and formats it as a
/// Sefaria `/api/v3/texts/...` JSON response so the frontend works seamlessly offline.
pub fn extract_v3_from_merged(merged_json: &str, section: Option<&str>, lang_dir: &str) -> Option<String> {
    let doc: Value = serde_json::from_str(merged_json).ok()?;
    let title = doc.get("title")?.as_str()?;
    let he_title = doc.get("heTitle").and_then(|v| v.as_str()).unwrap_or(title);
    let version_title = doc.get("versionTitle").and_then(|v| v.as_str()).unwrap_or("");
    let categories = doc.get("categories").cloned().unwrap_or_else(|| json!([]));
    let is_talmud = categories
        .as_array()
        .map(|a| a.iter().any(|c| c.as_str() == Some("Talmud")))
        .unwrap_or(false);
    let text_root = doc.get("text")?;

    let (section_text, section_ref, he_ref, next_ref, prev_ref, sections_json) = match text_root {
        Value::Array(arr) => {
            let idx = if let Some(sec) = section {
                if let Some(d_idx) = daf_to_idx(sec) {
                    d_idx
                } else {
                    let first_num: usize = sec.split(':').next()?.parse().ok()?;
                    first_num.checked_sub(1)?
                }
            } else {
                arr.iter().position(is_non_empty)?
            };
            let item = arr.get(idx)?;
            if !is_non_empty(item) {
                return None;
            }
            let fmt_sec = |i: usize| {
                if is_talmud {
                    format!("{title} {}", idx_to_daf(i))
                } else {
                    format!("{title} {}", i + 1)
                }
            };
            let cur_ref = fmt_sec(idx);
            let cur_he = if is_talmud {
                format!("{he_title} {}", idx_to_daf(idx))
            } else {
                format!("{he_title} {}", idx + 1)
            };
            let next = ((idx + 1)..arr.len())
                .find(|&i| is_non_empty(&arr[i]))
                .map(fmt_sec);
            let prev = (0..idx)
                .rev()
                .find(|&i| is_non_empty(&arr[i]))
                .map(fmt_sec);
            let secs = if is_talmud {
                json!([idx_to_daf(idx)])
            } else {
                json!([idx + 1])
            };
            (item.clone(), cur_ref, cur_he, next, prev, secs)
        }
        Value::Object(map) => {
            let keys: Vec<&String> = map.keys().filter(|k| is_non_empty(&map[*k])).collect();
            if keys.is_empty() {
                return None;
            }
            let key_idx = if let Some(sec) = section {
                keys.iter().position(|k| k.as_str() == sec)?
            } else {
                0
            };
            let key = keys[key_idx];
            let item = map.get(key)?;
            let cur_ref = format!("{title}, {key}");
            let cur_he = format!("{he_title}, {key}");
            let next = keys.get(key_idx + 1).map(|k| format!("{title}, {k}"));
            let prev = key_idx.checked_sub(1).and_then(|i| keys.get(i)).map(|k| format!("{title}, {k}"));
            (item.clone(), cur_ref, cur_he, next, prev, json!([]))
        }
        _ => return None,
    };

    let lang_code = if lang_dir == "English" { "en" } else { "he" };
    let direction = if lang_dir == "English" { "ltr" } else { "rtl" };
    let out = json!({
        "ref": section_ref,
        "sectionRef": section_ref,
        "heRef": he_ref,
        "indexTitle": title,
        "heIndexTitle": he_title,
        "categories": categories,
        "sections": sections_json,
        "next": next_ref,
        "prev": prev_ref,
        "versions": [{
            "text": section_text,
            "versionTitle": version_title,
            "language": lang_code,
            "direction": direction,
        }]
    });
    serde_json::to_string(&out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_gcs_url() {
        let u = gcs_merged_url(&["Tanakh".into(), "Torah".into()], "Genesis", "Hebrew");
        assert_eq!(
            u,
            "https://storage.googleapis.com/sefaria-export/json/Tanakh/Torah/Genesis/Hebrew/merged.json"
        );
    }

    #[test]
    fn splits_refs_accurately() {
        assert_eq!(split_ref("Berakhot 2a"), ("Berakhot", Some("2a")));
        assert_eq!(split_ref("Genesis 1"), ("Genesis", Some("1")));
        assert_eq!(split_ref("Me'or Einayim, Bereshit"), ("Me'or Einayim", Some("Bereshit")));
        assert_eq!(split_ref("Shulchan Arukh, Orach Chayim 1"), ("Shulchan Arukh, Orach Chayim", Some("1")));
        assert_eq!(split_ref("Genesis"), ("Genesis", None));
    }

    #[test]
    fn extracts_section_from_merged_json() {
        let merged = r#"{"title":"Genesis","heTitle":"בראשית","categories":["Tanakh","Torah"],"versionTitle":"Tanach","text":[["בראשית ברא"],["ויכלו השמים"]]}"#;
        let out = extract_v3_from_merged(merged, Some("1"), "Hebrew").unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["sectionRef"], "Genesis 1");
        assert_eq!(v["next"], "Genesis 2");
        assert_eq!(v["versions"][0]["text"][0], "בראשית ברא");
    }

    #[test]
    fn extracts_talmud_amud_from_merged_json() {
        let merged = r#"{"title":"Berakhot","heTitle":"ברכות","categories":["Talmud","Bavli"],"versionTitle":"Vilna","text":[[],[],["מאימתי"],["תנא היכא קאי"]]}"#;
        let out = extract_v3_from_merged(merged, Some("2a"), "Hebrew").unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["sectionRef"], "Berakhot 2a");
        assert_eq!(v["next"], "Berakhot 2b");
        assert_eq!(v["versions"][0]["text"][0], "מאימתי");
    }
}
