use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::{params, Connection};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;

#[derive(Default)]
struct WatchState {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSnapshot {
    path: String,
    name: String,
    contents: String,
    hash: String,
    mtime_ms: u128,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    path: String,
    name: String,
    hash: String,
    mtime_ms: u128,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFiles {
    app_path: String,
    disk_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDiffResult {
    files: DiffFiles,
    launched: bool,
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownFileChangedEvent {
    path: String,
    kind: String,
}

#[tauri::command]
fn read_markdown_file(path: String) -> Result<FileSnapshot, String> {
    read_snapshot(Path::new(&path))
}

#[tauri::command]
fn read_markdown_metadata(path: String) -> Result<FileMetadata, String> {
    let snapshot = read_snapshot(Path::new(&path))?;
    Ok(FileMetadata {
        path: snapshot.path,
        name: snapshot.name,
        hash: snapshot.hash,
        mtime_ms: snapshot.mtime_ms,
        size: snapshot.size,
    })
}

#[tauri::command]
fn write_markdown_file_atomic(path: String, contents: String) -> Result<FileSnapshot, String> {
    write_atomic(Path::new(&path), &contents)?;
    read_snapshot(Path::new(&path))
}

#[tauri::command]
fn read_app_state(document_path: String, key: String) -> Result<Option<String>, String> {
    let connection = open_sidecar(Path::new(&document_path))?;
    let mut statement = connection
        .prepare("select value from app_state where key = ?1")
        .map_err(to_string)?;
    let mut rows = statement.query(params![key]).map_err(to_string)?;
    match rows.next().map_err(to_string)? {
        Some(row) => row.get(0).map(Some).map_err(to_string),
        None => Ok(None),
    }
}

#[tauri::command]
fn write_app_state(document_path: String, key: String, value: String) -> Result<(), String> {
    let connection = open_sidecar(Path::new(&document_path))?;
    let updated_at = unix_time_ms(SystemTime::now())?;
    connection
        .execute(
            "insert into app_state (key, value, updated_at)
             values (?1, ?2, ?3)
             on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, updated_at.to_string()],
        )
        .map_err(to_string)?;
    Ok(())
}

#[tauri::command]
fn sidecar_path(document_path: String) -> Result<String, String> {
    Ok(sidecar_path_for(Path::new(&document_path))?
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
fn prepare_external_diff_files(
    document_path: String,
    app_source: String,
    disk_source: String,
) -> Result<DiffFiles, String> {
    let stem = Path::new(&document_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("mindmap.md");
    let nonce = unix_time_ms(SystemTime::now())?;
    let directory = std::env::temp_dir().join("mindmap-diff");
    fs::create_dir_all(&directory).map_err(to_string)?;

    let app_path = directory.join(format!("{stem}.{nonce}.app.md"));
    let disk_path = directory.join(format!("{stem}.{nonce}.disk.md"));
    fs::write(&app_path, app_source).map_err(to_string)?;
    fs::write(&disk_path, disk_source).map_err(to_string)?;

    Ok(DiffFiles {
        app_path: app_path.to_string_lossy().to_string(),
        disk_path: disk_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn open_external_diff(
    document_path: String,
    app_source: String,
    disk_source: String,
    diff_command: Option<String>,
) -> Result<OpenDiffResult, String> {
    let files = prepare_external_diff_files(document_path, app_source, disk_source)?;
    let command = diff_command.unwrap_or_else(default_diff_command);
    let mut parts = command.split_whitespace();
    let program = parts
        .next()
        .ok_or_else(|| "External diff command is empty.".to_string())?;
    let args: Vec<&str> = parts.collect();

    match Command::new(program)
        .args(args)
        .arg(&files.app_path)
        .arg(&files.disk_path)
        .spawn()
    {
        Ok(_) => Ok(OpenDiffResult {
            files,
            launched: true,
            message: format!("Launched external diff command: {command}"),
        }),
        Err(error) => Ok(OpenDiffResult {
            files,
            launched: false,
            message: format!("Could not launch external diff command '{command}': {error}"),
        }),
    }
}

#[tauri::command]
fn watch_markdown_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, WatchState>,
    path: String,
) -> Result<(), String> {
    let target = normalize_watch_path(Path::new(&path))?;
    let target_key = target.to_string_lossy().to_string();

    let mut watchers = state.watchers.lock().map_err(to_string)?;
    if watchers.contains_key(&target_key) {
        return Ok(());
    }

    let watcher =
        create_markdown_file_watcher_for_target(target, target_key.clone(), move |event| {
            let _ = app.emit("markdown-file-changed", event);
        })?;
    watchers.insert(target_key, watcher);
    Ok(())
}

#[cfg(test)]
fn create_markdown_file_watcher<F>(
    path: &Path,
    emit_change: F,
) -> Result<(String, RecommendedWatcher), String>
where
    F: FnMut(MarkdownFileChangedEvent) + Send + 'static,
{
    let target = normalize_watch_path(path)?;
    let target_key = target.to_string_lossy().to_string();
    let watcher = create_markdown_file_watcher_for_target(target, target_key.clone(), emit_change)?;
    Ok((target_key, watcher))
}

fn create_markdown_file_watcher_for_target<F>(
    target: PathBuf,
    target_key: String,
    mut emit_change: F,
) -> Result<RecommendedWatcher, String>
where
    F: FnMut(MarkdownFileChangedEvent) + Send + 'static,
{
    let watch_dir = target
        .parent()
        .ok_or_else(|| "Document path has no parent directory.".to_string())?
        .to_path_buf();
    let event_path = target_key.clone();
    let event_target = target.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        if let Ok(event) = result {
            if event_matches_path(&event, &event_target) {
                emit_change(MarkdownFileChangedEvent {
                    path: event_path.clone(),
                    kind: format!("{:?}", event.kind),
                });
            }
        }
    })
    .map_err(to_string)?;

    watcher
        .watch(&watch_dir, RecursiveMode::NonRecursive)
        .map_err(to_string)?;
    Ok(watcher)
}

#[tauri::command]
fn unwatch_markdown_file(state: tauri::State<'_, WatchState>, path: String) -> Result<(), String> {
    let target = normalize_watch_path(Path::new(&path))?;
    let target_key = target.to_string_lossy().to_string();
    state
        .watchers
        .lock()
        .map_err(to_string)?
        .remove(&target_key);
    Ok(())
}

#[tauri::command]
fn write_clipboard_text(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(to_string)?;
    clipboard.set_text(text).map_err(to_string)
}

#[tauri::command]
fn read_clipboard_text() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(to_string)?;
    clipboard.get_text().map_err(to_string)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WatchState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_markdown_file,
            read_markdown_metadata,
            write_markdown_file_atomic,
            read_app_state,
            write_app_state,
            sidecar_path,
            prepare_external_diff_files,
            open_external_diff,
            watch_markdown_file,
            unwatch_markdown_file,
            write_clipboard_text,
            read_clipboard_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn read_snapshot(path: &Path) -> Result<FileSnapshot, String> {
    let contents = fs::read_to_string(path).map_err(to_string)?;
    let metadata = fs::metadata(path).map_err(to_string)?;
    let modified = metadata.modified().map_err(to_string)?;

    Ok(FileSnapshot {
        path: path.to_string_lossy().to_string(),
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("untitled.md")
            .to_string(),
        hash: hash_contents(&contents),
        contents,
        mtime_ms: unix_time_ms(modified)?,
        size: metadata.len(),
    })
}

fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Document path has no parent directory.".to_string())?;
    fs::create_dir_all(parent).map_err(to_string)?;

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Document path has no file name.".to_string())?;
    let temp_path = parent.join(format!(".{file_name}.{}.tmp", std::process::id()));

    {
        let mut file = File::create(&temp_path).map_err(to_string)?;
        file.write_all(contents.as_bytes()).map_err(to_string)?;
        file.sync_all().map_err(to_string)?;
    }

    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        error.to_string()
    })
}

fn open_sidecar(document_path: &Path) -> Result<Connection, String> {
    let sidecar_path = sidecar_path_for(document_path)?;
    if let Some(parent) = sidecar_path.parent() {
        fs::create_dir_all(parent).map_err(to_string)?;
    }

    let connection = Connection::open(sidecar_path).map_err(to_string)?;
    connection
        .execute_batch(
            "create table if not exists app_state (
                key text primary key,
                value text not null,
                updated_at integer not null
            );",
        )
        .map_err(to_string)?;
    Ok(connection)
}

fn sidecar_path_for(document_path: &Path) -> Result<PathBuf, String> {
    let parent = document_path
        .parent()
        .ok_or_else(|| "Document path has no parent directory.".to_string())?;
    let file_name = document_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Document path has no file name.".to_string())?;
    Ok(parent.join(format!("{file_name}.mindmap.sqlite")))
}

fn hash_contents(contents: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(contents.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn unix_time_ms(time: SystemTime) -> Result<u128, String> {
    time.duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .map_err(to_string)
}

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn default_diff_command() -> String {
    #[cfg(target_os = "macos")]
    {
        "opendiff".to_string()
    }

    #[cfg(not(target_os = "macos"))]
    {
        "code --diff".to_string()
    }
}

fn normalize_watch_path(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        path.canonicalize().map_err(to_string)
    } else {
        Ok(path.to_path_buf())
    }
}

fn event_matches_path(event: &Event, target: &Path) -> bool {
    event.paths.iter().any(|path| {
        normalize_watch_path(path)
            .map(|event_path| event_path == target)
            .unwrap_or_else(|_| path == target)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{self, Receiver};
    use std::time::Duration;

    #[test]
    fn writes_and_reads_markdown_atomically() {
        let temp_dir = tempfile::tempdir().unwrap();
        let path = temp_dir.path().join("map.md");

        write_atomic(&path, "# Map\n\n-\n").unwrap();
        let snapshot = read_snapshot(&path).unwrap();

        assert_eq!(snapshot.name, "map.md");
        assert_eq!(snapshot.contents, "# Map\n\n-\n");
        assert_eq!(snapshot.size, 9);
        assert_eq!(snapshot.hash.len(), 64);
    }

    #[test]
    fn stores_app_state_in_sqlite_sidecar() {
        let temp_dir = tempfile::tempdir().unwrap();
        let document_path = temp_dir.path().join("map.md");
        fs::write(&document_path, "# Map\n\n-\n").unwrap();
        let connection = open_sidecar(&document_path).unwrap();

        connection
            .execute(
                "insert into app_state (key, value, updated_at) values (?1, ?2, ?3)",
                params!["view_state", "{\"zoom\":1}", "1"],
            )
            .unwrap();

        let value: String = connection
            .query_row(
                "select value from app_state where key = ?1",
                params!["view_state"],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(value, "{\"zoom\":1}");
        assert!(sidecar_path_for(&document_path)
            .unwrap()
            .ends_with("map.md.mindmap.sqlite"));
    }

    #[test]
    fn matches_file_watcher_events_by_target_path() {
        let temp_dir = tempfile::tempdir().unwrap();
        let document_path = temp_dir.path().join("map.md");
        let other_path = temp_dir.path().join("other.md");
        fs::write(&document_path, "# Map\n\n-\n").unwrap();
        fs::write(&other_path, "# Other\n\n-\n").unwrap();
        let target = normalize_watch_path(&document_path).unwrap();

        let matching_event = Event {
            kind: notify::EventKind::Modify(notify::event::ModifyKind::Data(
                notify::event::DataChange::Content,
            )),
            paths: vec![document_path],
            attrs: notify::event::EventAttributes::new(),
        };
        let other_event = Event {
            kind: notify::EventKind::Modify(notify::event::ModifyKind::Data(
                notify::event::DataChange::Content,
            )),
            paths: vec![other_path],
            attrs: notify::event::EventAttributes::new(),
        };

        assert!(event_matches_path(&matching_event, &target));
        assert!(!event_matches_path(&other_event, &target));
    }

    #[test]
    #[ignore = "long-running native watcher stress test; run pnpm test:tauri:watch"]
    fn stress_markdown_file_watcher_receives_repeated_changes() {
        let iterations = env_usize("MINDMAP_WATCH_STRESS_ITERATIONS", 120);
        let timeout = Duration::from_millis(env_u64("MINDMAP_WATCH_STRESS_TIMEOUT_MS", 5000));
        let interval = Duration::from_millis(env_u64("MINDMAP_WATCH_STRESS_INTERVAL_MS", 250));
        let temp_dir = tempfile::tempdir().unwrap();
        let document_path = temp_dir.path().join("map.md");
        let noise_path = temp_dir.path().join("noise.md");
        fs::write(&document_path, "# Map\n\n-\n").unwrap();
        fs::write(&noise_path, "# Noise\n\n-\n").unwrap();

        let (tx, rx) = mpsc::channel();
        let (_target_key, _watcher) = create_markdown_file_watcher(&document_path, move |event| {
            let _ = tx.send(event);
        })
        .unwrap();

        for index in 0..iterations {
            drain_pending_events(&rx);
            fs::write(&noise_path, format!("# Noise {index}\n\n-\n")).unwrap();
            fs::write(
                &document_path,
                format!("# Map {index}\n\n- event {index}\n"),
            )
            .unwrap();

            let event = rx
                .recv_timeout(timeout)
                .unwrap_or_else(|error| panic!("watcher missed iteration {index}: {error}"));
            assert_eq!(
                event.path,
                normalize_watch_path(&document_path)
                    .unwrap()
                    .to_string_lossy()
                    .to_string()
            );

            if !interval.is_zero() {
                std::thread::sleep(interval);
            }
        }
    }

    fn drain_pending_events(receiver: &Receiver<MarkdownFileChangedEvent>) {
        while receiver.try_recv().is_ok() {}
    }

    fn env_usize(key: &str, default: usize) -> usize {
        std::env::var(key)
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(default)
    }

    fn env_u64(key: &str, default: u64) -> u64 {
        std::env::var(key)
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(default)
    }
}
