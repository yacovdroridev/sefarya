mod books;
mod cache;
mod video;

use cache::Cache;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tokio::sync::Semaphore;

const SEFARIA: &str = "https://www.sefaria.org/api/";
const VIDEO_CHANNEL: &str = "הר עציון";

struct AppState {
    cache: Arc<Cache>,
    http: reqwest::Client,
    prefetch_sem: Arc<Semaphore>,
    dl_cancel: Arc<AtomicBool>,
}

#[derive(Serialize)]
struct FetchResult {
    body: String,
    from_cache: bool,
    stale: bool,
}

/// GET a Sefaria API path (e.g. "v3/texts/Berakhot.2a?version=hebrew") with SQLite caching.
/// `max_age_secs`: None = cached forever (texts don't change); Some(n) = refresh after n seconds.
/// On network failure, stale cache is returned so viewed pages work offline.
#[tauri::command]
async fn sefaria_get(
    state: State<'_, AppState>,
    path: String,
    max_age_secs: Option<i64>,
) -> Result<FetchResult, String> {
    let cached = state.cache.get("sefaria", &path);
    if let Some((body, at)) = &cached {
        let fresh = max_age_secs.map_or(true, |m| cache::now() - at < m);
        if fresh {
            return Ok(FetchResult { body: body.clone(), from_cache: true, stale: false });
        }
    }
    // Check if the full book was bulk-downloaded from Google Cloud Storage (`ns = "books"`).
    if let Some((decoded_ref, lang_dir)) = books::parse_text_api_path(&path) {
        let (book_title, section) = books::split_ref(&decoded_ref);
        let bkey = format!("{book_title}|{lang_dir}");
        if let Some((merged, _)) = state.cache.get("books", &bkey) {
            if let Some(synth) = books::extract_v3_from_merged(&merged, section, lang_dir) {
                return Ok(FetchResult { body: synth, from_cache: true, stale: false });
            }
        }
    }
    let url = format!("{SEFARIA}{path}");
    let res = state
        .http
        .get(&url)
        .send()
        .await
        .and_then(|r| r.error_for_status());
    match res {
        Ok(r) => {
            let body = r.text().await.map_err(|e| e.to_string())?;
            // Sefaria sometimes returns 200 with {"error": ...}; don't cache those.
            if !body.trim_start().starts_with("{\"error\"") {
                state.cache.put("sefaria", &path, &body);
            }
            Ok(FetchResult { body, from_cache: false, stale: false })
        }
        Err(e) => match cached {
            Some((body, _)) => Ok(FetchResult { body, from_cache: true, stale: true }),
            None => Err(format!("שגיאת רשת: {e}")),
        },
    }
}

#[derive(Serialize)]
struct VideoResult {
    hit: Option<video::VideoHit>,
    search_url: String,
    from_cache: bool,
}

/// Find the Daf Yomi lesson video (Rabbi Udi Schwartz / Har Etzion) for a given amud.
#[tauri::command]
async fn find_video(
    state: State<'_, AppState>,
    tractate_he: String,
    daf: u32,
    amud: u32,
    force: Option<bool>,
) -> Result<VideoResult, String> {
    let daf_he = video::to_hebrew_numeral(daf);
    let search_q = format!("דף יומי מסכת {tractate_he} דף {daf_he} הרב אודי שוורץ");
    let search_url = format!(
        "https://www.youtube.com/results?search_query={}",
        urlencoding::encode(&search_q)
    );
    let key = format!("{tractate_he}|{daf}|{amud}");
    if !force.unwrap_or(false) {
        if let Some((v, at)) = state.cache.get("video", &key) {
            let hit: Option<video::VideoHit> = serde_json::from_str(&v).ok();
            // Negative results expire after a day (new lessons get uploaded).
            if hit.is_some() || cache::now() - at < 86_400 {
                return Ok(VideoResult { hit, search_url, from_cache: true });
            }
        }
    }

    let queries = [
        format!("דף יומי מסכת {tractate_he} דף {daf_he} הר עציון"),
        search_q.clone(),
    ];
    let mut hit = None;
    for q in &queries {
        let results = video::yt_search(q, 20).await?;
        hit = video::pick_best(&results, VIDEO_CHANNEL, &tractate_he, daf, amud);
        if hit.is_some() {
            break;
        }
    }
    state.cache.put(
        "video",
        &key,
        &serde_json::to_string(&hit).unwrap_or_else(|_| "null".into()),
    );
    Ok(VideoResult { hit, search_url, from_cache: false })
}

#[derive(Serialize)]
struct BookAudioResult {
    hits: Vec<video::VideoHit>,
    search_url: String,
    from_cache: bool,
}

/// Find YouTube audio/lesson recordings for any non-Talmud Sefaria book section.
#[tauri::command]
async fn find_book_audio(
    state: State<'_, AppState>,
    section_he: String,
    category: Option<String>,
    force: Option<bool>,
) -> Result<BookAudioResult, String> {
    let cat = category.unwrap_or_default();
    let search_q = video::book_audio_query(&section_he, &cat);
    let search_url = format!(
        "https://www.youtube.com/results?search_query={}",
        urlencoding::encode(&search_q)
    );
    let key = format!("book|{section_he}");
    if !force.unwrap_or(false) {
        if let Some((v, at)) = state.cache.get("video", &key) {
            if let Ok(hits) = serde_json::from_str::<Vec<video::VideoHit>>(&v) {
                if !hits.is_empty() || cache::now() - at < 86_400 {
                    return Ok(BookAudioResult { hits, search_url, from_cache: true });
                }
            }
        }
    }

    let raw = video::yt_search(&search_q, 6).await?;
    let hits: Vec<video::VideoHit> = raw
        .into_iter()
        .take(5)
        .map(|(id, channel, title)| video::VideoHit {
            url: format!("https://www.youtube.com/watch?v={id}"),
            id,
            title,
            channel,
        })
        .collect();

    state.cache.put(
        "video",
        &key,
        &serde_json::to_string(&hits).unwrap_or_else(|_| "[]".into()),
    );
    Ok(BookAudioResult { hits, search_url, from_cache: false })
}

/// Resolves a direct audio stream URL for inline HTML5 audio playback.
#[tauri::command]
async fn get_audio_stream(id: String) -> Result<String, String> {
    video::yt_audio_url(&id).await
}

/// Opens a YouTube video in a separate app window (top-level navigation avoids embed restrictions).
#[tauri::command]
async fn open_video_window(app: tauri::AppHandle, id: String, title: String) -> Result<(), String> {
    let label = "video";
    let url = format!("https://www.youtube.com/watch?v={id}");
    let parsed = url.parse::<tauri::Url>().map_err(|e| e.to_string())?;
    if let Some(w) = app.get_webview_window(label) {
        w.navigate(parsed).map_err(|e| e.to_string())?;
        let _ = w.set_title(&title);
        let _ = w.set_focus();
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::External(parsed))
        .title(title)
        .inner_size(960.0, 600.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn clear_cache(state: State<'_, AppState>, ns: String) -> usize {
    state.cache.clear(&ns)
}

#[tauri::command]
fn cache_stats(state: State<'_, AppState>) -> cache::CacheStats {
    state.cache.stats()
}

/// Fire-and-forget background prefetch of Sefaria API paths into SQLite so page turns are instant.
#[tauri::command]
fn prefetch_paths(state: State<'_, AppState>, paths: Vec<String>) {
    let cache = Arc::clone(&state.cache);
    let http = state.http.clone();
    let sem = Arc::clone(&state.prefetch_sem);
    for path in paths.into_iter().take(12) {
        if cache.get("sefaria", &path).is_some() {
            continue;
        }
        let cache = Arc::clone(&cache);
        let http = http.clone();
        let sem = Arc::clone(&sem);
        tauri::async_runtime::spawn(async move {
            let Ok(_permit) = sem.acquire_owned().await else { return };
            if cache.get("sefaria", &path).is_some() {
                return;
            }
            let url = format!("{SEFARIA}{path}");
            if let Ok(Ok(r)) = http.get(&url).send().await.map(|r| r.error_for_status()) {
                if let Ok(body) = r.text().await {
                    if !body.trim_start().starts_with("{\"error\"") {
                        cache.put("sefaria", &path, &body);
                    }
                }
            }
        });
    }
}

/// Cancels an active `download_books_fast` operation.
#[tauri::command]
fn cancel_fast_download(state: State<'_, AppState>) {
    state.dl_cancel.store(true, Ordering::Relaxed);
}

/// Bulk-downloads whole books directly from Google Cloud Storage (`sefaria-export/json/.../merged.json`)
/// with 16 concurrent HTTP/2 streams — ~100x faster than per-chapter API downloads.
#[tauri::command]
async fn download_books_fast(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    specs: Vec<books::BookDownloadSpec>,
    lang: Option<String>,
) -> Result<books::FastDownloadResult, String> {
    let lang_dir = if lang.as_deref() == Some("english") {
        "English".to_string()
    } else {
        "Hebrew".to_string()
    };
    state.dl_cancel.store(false, Ordering::Relaxed);
    let total = specs.len();
    let completed = Arc::new(AtomicUsize::new(0));
    let downloaded = Arc::new(AtomicUsize::new(0));
    let skipped = Arc::new(AtomicUsize::new(0));
    let failed = Arc::new(AtomicUsize::new(0));
    let sem = Arc::new(Semaphore::new(16));

    let mut handles = Vec::with_capacity(total);
    for spec in specs {
        let app = app.clone();
        let cache = Arc::clone(&state.cache);
        let http = state.http.clone();
        let cancel = Arc::clone(&state.dl_cancel);
        let sem = Arc::clone(&sem);
        let completed = Arc::clone(&completed);
        let downloaded = Arc::clone(&downloaded);
        let skipped = Arc::clone(&skipped);
        let failed = Arc::clone(&failed);
        let lang_dir = lang_dir.clone();

        handles.push(tauri::async_runtime::spawn(async move {
            let Ok(_permit) = sem.acquire_owned().await else { return };
            if cancel.load(Ordering::Relaxed) {
                return;
            }
            let bkey = format!("{}|{}", spec.title, lang_dir);
            if cache.get("books", &bkey).is_some() {
                skipped.fetch_add(1, Ordering::Relaxed);
                let c = completed.fetch_add(1, Ordering::Relaxed) + 1;
                let _ = app.emit(
                    "dl-progress",
                    books::FastDownloadProgress {
                        completed: c,
                        total,
                        title: spec.title,
                        he_title: spec.he_title,
                        skipped: true,
                        ok: true,
                    },
                );
                return;
            }
            let url = books::gcs_merged_url(&spec.categories, &spec.title, &lang_dir);
            let ok = match http.get(&url).send().await.and_then(|r| r.error_for_status()) {
                Ok(r) => match r.text().await {
                    Ok(body) if body.starts_with('{') => {
                        cache.put("books", &bkey, &body);
                        downloaded.fetch_add(1, Ordering::Relaxed);
                        true
                    }
                    _ => {
                        failed.fetch_add(1, Ordering::Relaxed);
                        false
                    }
                },
                Err(_) => {
                    failed.fetch_add(1, Ordering::Relaxed);
                    false
                }
            };
            let c = completed.fetch_add(1, Ordering::Relaxed) + 1;
            let _ = app.emit(
                "dl-progress",
                books::FastDownloadProgress {
                    completed: c,
                    total,
                    title: spec.title,
                    he_title: spec.he_title,
                    skipped: false,
                    ok,
                },
            );
        }));
    }

    for h in handles {
        let _ = h.await;
    }

    Ok(books::FastDownloadResult {
        completed: completed.load(Ordering::Relaxed),
        downloaded: downloaded.load(Ordering::Relaxed),
        skipped: skipped.load(Ordering::Relaxed),
        failed: failed.load(Ordering::Relaxed),
        aborted: state.dl_cancel.load(Ordering::Relaxed),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let cache = Arc::new(Cache::open(&dir.join("cache.sqlite"))?);
            let http = reqwest::Client::builder()
                .user_agent(concat!("Sefarya/", env!("CARGO_PKG_VERSION"), " (Linux desktop client)"))
                .pool_max_idle_per_host(20)
                .tcp_nodelay(true)
                .http2_adaptive_window(true)
                .timeout(std::time::Duration::from_secs(30))
                .build()?;
            let prefetch_sem = Arc::new(Semaphore::new(6));
            let dl_cancel = Arc::new(AtomicBool::new(false));
            app.manage(AppState { cache, http, prefetch_sem, dl_cancel });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sefaria_get,
            prefetch_paths,
            download_books_fast,
            cancel_fast_download,
            find_video,
            find_book_audio,
            get_audio_stream,
            open_video_window,
            clear_cache,
            cache_stats
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
