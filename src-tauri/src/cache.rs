use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize)]
pub struct CacheStats {
    pub sefaria_count: usize,
    pub books_count: usize,
    pub video_count: usize,
    pub db_bytes: u64,
}

pub struct Cache {
    conn: Mutex<Connection>,
    path: Option<PathBuf>,
}

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

impl Cache {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn, Some(path.to_path_buf()))
    }

    #[cfg(test)]
    pub fn in_memory() -> rusqlite::Result<Self> {
        Self::init(Connection::open_in_memory()?, None)
    }

    fn init(conn: Connection, path: Option<PathBuf>) -> rusqlite::Result<Self> {
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA temp_store=MEMORY;
             PRAGMA cache_size=-16000;
             PRAGMA mmap_size=67108864;
             CREATE TABLE IF NOT EXISTS kv (
                ns TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                fetched_at INTEGER NOT NULL,
                PRIMARY KEY (ns, key)
             );",
        )?;
        Ok(Self { conn: Mutex::new(conn), path })
    }

    /// Returns (value, fetched_at).
    pub fn get(&self, ns: &str, key: &str) -> Option<(String, i64)> {
        let conn = self.conn.lock().ok()?;
        conn.query_row(
            "SELECT value, fetched_at FROM kv WHERE ns=?1 AND key=?2",
            params![ns, key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .ok()
        .flatten()
    }

    pub fn put(&self, ns: &str, key: &str, value: &str) {
        if let Ok(conn) = self.conn.lock() {
            let _ = conn.execute(
                "INSERT OR REPLACE INTO kv (ns, key, value, fetched_at) VALUES (?1, ?2, ?3, ?4)",
                params![ns, key, value, now()],
            );
        }
    }

    pub fn clear(&self, ns: &str) -> usize {
        self.conn
            .lock()
            .ok()
            .and_then(|c| c.execute("DELETE FROM kv WHERE ns=?1", params![ns]).ok())
            .unwrap_or(0)
    }

    pub fn stats(&self) -> CacheStats {
        let (sefaria_count, books_count, video_count) = self
            .conn
            .lock()
            .ok()
            .map(|c| {
                let s: i64 = c
                    .query_row("SELECT COUNT(*) FROM kv WHERE ns='sefaria'", [], |r| r.get(0))
                    .unwrap_or(0);
                let b: i64 = c
                    .query_row("SELECT COUNT(*) FROM kv WHERE ns='books'", [], |r| r.get(0))
                    .unwrap_or(0);
                let v: i64 = c
                    .query_row("SELECT COUNT(*) FROM kv WHERE ns='video'", [], |r| r.get(0))
                    .unwrap_or(0);
                (s.max(0) as usize, b.max(0) as usize, v.max(0) as usize)
            })
            .unwrap_or((0, 0, 0));
        let db_bytes = self
            .path
            .as_ref()
            .and_then(|p| std::fs::metadata(p).ok())
            .map(|m| m.len())
            .unwrap_or(0);
        CacheStats { sefaria_count, books_count, video_count, db_bytes }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let c = Cache::in_memory().unwrap();
        assert!(c.get("a", "k").is_none());
        c.put("a", "k", "v1");
        c.put("a", "k", "v2");
        assert_eq!(c.get("a", "k").unwrap().0, "v2");
        assert!(c.get("b", "k").is_none());
        assert_eq!(c.clear("a"), 1);
        assert!(c.get("a", "k").is_none());
    }
}
