use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

use crate::error::{BenchError, Result};

/// Task category classification
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TaskCategory {
    BugFix,
    Feature,
    Refactor,
    Tools,
}

impl std::fmt::Display for TaskCategory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TaskCategory::BugFix => write!(f, "bug-fix"),
            TaskCategory::Feature => write!(f, "feature"),
            TaskCategory::Refactor => write!(f, "refactor"),
            TaskCategory::Tools => write!(f, "tools"),
        }
    }
}

/// Task difficulty level
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Difficulty {
    Easy,
    Medium,
    Hard,
}

impl std::fmt::Display for Difficulty {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Difficulty::Easy => write!(f, "easy"),
            Difficulty::Medium => write!(f, "medium"),
            Difficulty::Hard => write!(f, "hard"),
        }
    }
}

/// Source repository configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceConfig {
    /// Repository URL
    pub repository: String,
    /// Commit hash to checkout
    pub commit: String,
}

/// Verification configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationConfig {
    /// Verification type (e.g., "pytest", "cargo-test")
    #[serde(rename = "type")]
    pub verification_type: String,
    /// Command to run for verification
    pub command: String,
    /// Timeout in seconds
    #[serde(default = "default_timeout")]
    pub timeout: u64,
}

/// Agent permissions configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PermissionsConfig {
    /// Permission mode: "acceptEdits", "bypassPermissions", "default", "dontAsk", "plan"
    /// - "bypassPermissions": Skip all permission checks
    /// - "dontAsk": Auto-approve all permissions
    /// - "default": Ask for each permission (default)
    #[serde(default)]
    pub mode: Option<String>,
    /// Allow file write operations
    #[serde(default)]
    pub write: bool,
    /// Allow file read operations (usually allowed by default)
    #[serde(default = "default_true")]
    pub read: bool,
    /// Allow bash command execution
    #[serde(default)]
    pub bash: bool,
    /// Allow web fetch operations
    #[serde(default)]
    pub web_fetch: bool,
}

fn default_true() -> bool {
    true
}

fn default_timeout() -> u64 {
    60
}

/// Task metadata
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TaskMetadata {
    /// Tags for categorization
    #[serde(default)]
    pub tags: Vec<String>,
    /// Additional arbitrary metadata
    #[serde(flatten)]
    pub extra: HashMap<String, serde_yaml::Value>,
}

/// A benchmark task definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    /// Unique identifier (e.g., BUG-001)
    pub id: String,
    /// Brief description
    pub title: String,
    /// Task type
    pub category: TaskCategory,
    /// Difficulty level
    pub difficulty: Difficulty,
    /// Source repository configuration
    pub source: SourceConfig,
    /// Task instructions for the agent
    pub prompt: String,
    /// Verification configuration
    pub verification: VerificationConfig,
    /// Agent permissions configuration
    #[serde(default)]
    pub permissions: PermissionsConfig,
    /// Optional metadata
    #[serde(default)]
    pub metadata: TaskMetadata,
}

impl Task {
    /// Load a task from a YAML file
    pub fn from_file(path: &Path) -> Result<Self> {
        let content = std::fs::read_to_string(path).map_err(|e| {
            BenchError::TaskLoadError(format!("Failed to read {}: {}", path.display(), e))
        })?;

        let task: Task = serde_yaml::from_str(&content)?;
        task.validate()?;
        Ok(task)
    }

    /// Validate the task configuration
    pub fn validate(&self) -> Result<()> {
        if self.id.is_empty() {
            return Err(BenchError::InvalidTaskFormat("Task ID cannot be empty".into()));
        }
        if self.title.is_empty() {
            return Err(BenchError::InvalidTaskFormat("Task title cannot be empty".into()));
        }
        if self.prompt.is_empty() {
            return Err(BenchError::InvalidTaskFormat("Task prompt cannot be empty".into()));
        }
        if self.source.repository.is_empty() {
            return Err(BenchError::InvalidTaskFormat("Source repository cannot be empty".into()));
        }
        if self.source.commit.is_empty() {
            return Err(BenchError::InvalidTaskFormat("Source commit cannot be empty".into()));
        }
        if self.verification.command.is_empty() {
            return Err(BenchError::InvalidTaskFormat(
                "Verification command cannot be empty".into(),
            ));
        }
        Ok(())
    }
}

/// Task loader for discovering and loading benchmark tasks
pub struct TaskLoader {
    tasks_dir: std::path::PathBuf,
}

impl TaskLoader {
    /// Create a new task loader
    pub fn new(tasks_dir: impl AsRef<Path>) -> Self {
        Self {
            tasks_dir: tasks_dir.as_ref().to_path_buf(),
        }
    }

    /// Load all tasks from the tasks directory
    pub fn load_all(&self) -> Result<Vec<Task>> {
        let mut tasks = Vec::new();

        if !self.tasks_dir.exists() {
            return Ok(tasks);
        }

        self.load_recursive(&self.tasks_dir, &mut tasks)?;
        Ok(tasks)
    }

    /// Recursively load tasks from a directory
    fn load_recursive(&self, dir: &Path, tasks: &mut Vec<Task>) -> Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
                self.load_recursive(&path, tasks)?;
            } else if let Some(ext) = path.extension() {
                if ext == "yaml" || ext == "yml" {
                    match Task::from_file(&path) {
                        Ok(task) => tasks.push(task),
                        Err(e) => {
                            eprintln!("Warning: Failed to load {}: {}", path.display(), e);
                        }
                    }
                }
            }
        }
        Ok(())
    }

    /// Load a specific task by ID
    pub fn load_by_id(&self, id: &str) -> Result<Task> {
        let tasks = self.load_all()?;
        tasks
            .into_iter()
            .find(|t| t.id == id)
            .ok_or_else(|| BenchError::TaskNotFound(id.to_string()))
    }

    /// List all available task IDs
    pub fn list_ids(&self) -> Result<Vec<String>> {
        let tasks = self.load_all()?;
        Ok(tasks.into_iter().map(|t| t.id).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_task_validation() {
        let task = Task {
            id: "TEST-001".to_string(),
            title: "Test task".to_string(),
            category: TaskCategory::BugFix,
            difficulty: Difficulty::Easy,
            source: SourceConfig {
                repository: "https://github.com/example/repo".to_string(),
                commit: "abc123".to_string(),
            },
            prompt: "Fix the bug".to_string(),
            verification: VerificationConfig {
                verification_type: "pytest".to_string(),
                command: "pytest tests/".to_string(),
                timeout: 60,
            },
            permissions: PermissionsConfig::default(),
            metadata: TaskMetadata::default(),
        };

        assert!(task.validate().is_ok());
    }

    #[test]
    fn test_task_validation_empty_id() {
        let task = Task {
            id: "".to_string(),
            title: "Test task".to_string(),
            category: TaskCategory::BugFix,
            difficulty: Difficulty::Easy,
            source: SourceConfig {
                repository: "https://github.com/example/repo".to_string(),
                commit: "abc123".to_string(),
            },
            prompt: "Fix the bug".to_string(),
            verification: VerificationConfig {
                verification_type: "pytest".to_string(),
                command: "pytest tests/".to_string(),
                timeout: 60,
            },
            permissions: PermissionsConfig::default(),
            metadata: TaskMetadata::default(),
        };

        assert!(task.validate().is_err());
    }
}
