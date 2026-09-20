//! Append-only log file with one rollover, used to tee the sidecar's output to disk.
//!
//! Spec section 11: when the backend dies the dialog has to point the operator at a file, so the
//! console the shell plugin writes to is not enough. Volume is low (startup lines, job warnings),
//! so each line opens and closes the file: that keeps rotation safe on Windows, where a rename
//! fails while the file is still open.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Roll over at 5 MB, keeping one previous file (`sidecar.log.1`).
pub const MAX_BYTES: u64 = 5 * 1024 * 1024;

pub struct RotatingLog {
    path: PathBuf,
    max_bytes: u64,
}

impl RotatingLog {
    pub fn new(path: impl Into<PathBuf>, max_bytes: u64) -> Self {
        Self {
            path: path.into(),
            max_bytes,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Append one line. Logging must never take the app down, so failures are reported and dropped.
    pub fn append(&self, line: &str) {
        if let Err(e) = self.try_append(line) {
            eprintln!("[backend] could not write {}: {e}", self.path.display());
        }
    }

    fn try_append(&self, line: &str) -> std::io::Result<()> {
        // The shell plugin hands over whatever line ending the child wrote, so trim it: the file
        // holds one line per event rather than a blank line between every two.
        let line = line.trim_end_matches(['\r', '\n']);
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        self.rotate_if_full(line.len() as u64 + 1)?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        writeln!(file, "{line}")
    }

    fn rotate_if_full(&self, incoming: u64) -> std::io::Result<()> {
        let size = match fs::metadata(&self.path) {
            Ok(m) => m.len(),
            Err(_) => return Ok(()), // nothing written yet
        };
        if size + incoming <= self.max_bytes {
            return Ok(());
        }
        let previous = self.previous_path();
        let _ = fs::remove_file(&previous);
        fs::rename(&self.path, &previous)
    }

    fn previous_path(&self) -> PathBuf {
        let name = self
            .path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "sidecar.log".into());
        self.path.with_file_name(format!("{name}.1"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("kestrel-logfile-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn appends_lines_and_creates_the_folder() {
        let dir = temp_dir("append");
        let log = RotatingLog::new(dir.join("logs").join("sidecar.log"), MAX_BYTES);

        log.append("first");
        log.append("second");

        assert_eq!(fs::read_to_string(log.path()).unwrap(), "first\nsecond\n");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn writes_one_line_per_event_whatever_line_ending_it_arrived_with() {
        let dir = temp_dir("endings");
        let log = RotatingLog::new(dir.join("sidecar.log"), MAX_BYTES);

        log.append("plain");
        log.append("with crlf\r\n");
        log.append("with lf\n");

        assert_eq!(
            fs::read_to_string(log.path()).unwrap(),
            "plain\nwith crlf\nwith lf\n"
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rolls_over_once_the_limit_is_reached() {
        let dir = temp_dir("rotate");
        let log = RotatingLog::new(dir.join("sidecar.log"), 12);

        log.append("0123456789"); // 11 bytes with the newline
        log.append("next");

        assert_eq!(
            fs::read_to_string(dir.join("sidecar.log.1")).unwrap(),
            "0123456789\n"
        );
        assert_eq!(
            fs::read_to_string(dir.join("sidecar.log")).unwrap(),
            "next\n"
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn keeps_only_one_previous_file() {
        let dir = temp_dir("rotate-twice");
        let log = RotatingLog::new(dir.join("sidecar.log"), 12);

        log.append("0123456789");
        log.append("aaaaaaaaaa");
        log.append("bbbb");

        assert_eq!(
            fs::read_to_string(dir.join("sidecar.log.1")).unwrap(),
            "aaaaaaaaaa\n"
        );
        assert_eq!(
            fs::read_to_string(dir.join("sidecar.log")).unwrap(),
            "bbbb\n"
        );
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
        fs::remove_dir_all(&dir).unwrap();
    }
}
