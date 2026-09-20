//! One-time move of the pre-rename app-data folder.
//!
//! Tauri derives the app-data folder from the bundle identifier, so renaming the app from
//! `ai.synapse-solutions.machinery-app` to `ai.synapse-solutions.kestrel-ai` would otherwise
//! point a returning operator at an empty folder: no recent projects, no settings, and the
//! sidecar log starting over. This runs once at startup, before the sidecar is spawned, because
//! `logs/` belongs to the shell and has to move with the rest.

use std::fs;
use std::path::Path;

/// What [`migrate`] did, so the caller can say so in the log.
#[derive(Debug, PartialEq, Eq)]
pub enum Migration {
    /// No pre-rename folder: a clean install, or already migrated.
    NothingToDo,
    /// The pre-rename folder was moved onto the new path.
    Moved,
    /// Both exist. Left untouched: merging could lose data, so a human decides.
    BothPresent,
    /// The move failed (typically a locked file). The app still starts, with an empty folder.
    Failed(String),
}

/// Move `legacy` onto `new`, once. Safe to call on every launch.
pub fn migrate(legacy: &Path, new: &Path) -> Migration {
    if !legacy.exists() {
        return Migration::NothingToDo;
    }
    if new.exists() {
        return Migration::BothPresent;
    }
    if let Some(parent) = new.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return Migration::Failed(e.to_string());
        }
    }
    match fs::rename(legacy, new) {
        Ok(()) => Migration::Moved,
        Err(e) => Migration::Failed(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("kestrel-appdata-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn seed(dir: &PathBuf, marker: &str) {
        fs::create_dir_all(dir.join("logs")).unwrap();
        fs::write(dir.join("recent_projects.json"), marker).unwrap();
    }

    #[test]
    fn moves_the_legacy_folder_when_only_it_exists() {
        let root = scratch("moves");
        let (legacy, new) = (root.join("old"), root.join("new"));
        seed(&legacy, "mine");

        assert_eq!(migrate(&legacy, &new), Migration::Moved);
        assert_eq!(fs::read_to_string(new.join("recent_projects.json")).unwrap(), "mine");
        assert!(new.join("logs").is_dir());
        assert!(!legacy.exists());
    }

    #[test]
    fn leaves_both_alone_when_both_exist() {
        let root = scratch("both");
        let (legacy, new) = (root.join("old"), root.join("new"));
        seed(&legacy, "old");
        seed(&new, "new");

        assert_eq!(migrate(&legacy, &new), Migration::BothPresent);
        assert_eq!(fs::read_to_string(legacy.join("recent_projects.json")).unwrap(), "old");
        assert_eq!(fs::read_to_string(new.join("recent_projects.json")).unwrap(), "new");
    }

    #[test]
    fn does_nothing_when_there_is_no_legacy_folder() {
        let root = scratch("none");
        assert_eq!(migrate(&root.join("old"), &root.join("new")), Migration::NothingToDo);
    }

    #[test]
    fn is_idempotent() {
        let root = scratch("idempotent");
        let (legacy, new) = (root.join("old"), root.join("new"));
        seed(&legacy, "mine");

        assert_eq!(migrate(&legacy, &new), Migration::Moved);
        assert_eq!(migrate(&legacy, &new), Migration::NothingToDo);
        assert_eq!(fs::read_to_string(new.join("recent_projects.json")).unwrap(), "mine");
    }
}
