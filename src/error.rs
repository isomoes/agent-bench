use thiserror::Error;

/// Custom error types for Agent Bench
#[derive(Error, Debug)]
pub enum BenchError {
    #[error("Task not found: {0}")]
    TaskNotFound(String),

    #[error("Invalid task format: {0}")]
    InvalidTaskFormat(String),

    #[error("Task loading failed: {0}")]
    TaskLoadError(String),

    #[error("Agent execution failed: {0}")]
    AgentError(String),

    #[error("Verification failed: {0}")]
    VerificationError(String),

    #[error("Timeout after {0} seconds")]
    Timeout(u64),

    #[error("Git operation failed: {0}")]
    GitError(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("YAML parsing error: {0}")]
    YamlError(#[from] serde_yaml::Error),

    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, BenchError>;
