use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

use crate::error::{BenchError, Result};
use crate::task::Task;

/// Verification result
#[derive(Debug, Clone)]
pub struct VerificationResult {
    /// Whether verification passed
    pub passed: bool,
    /// Exit code from the verification command
    pub exit_code: Option<i32>,
    /// Standard output
    pub stdout: String,
    /// Standard error
    pub stderr: String,
    /// Duration of verification
    pub duration_secs: f64,
}

/// Verifier for running task verification commands
pub struct Verifier;

impl Verifier {
    /// Run verification for a task in the given workspace
    pub async fn verify(task: &Task, workspace: &Path) -> Result<VerificationResult> {
        let start = std::time::Instant::now();
        let timeout_duration = Duration::from_secs(task.verification.timeout);

        // Parse the command
        let command_parts: Vec<&str> = task.verification.command.split_whitespace().collect();
        if command_parts.is_empty() {
            return Err(BenchError::VerificationError(
                "Empty verification command".into(),
            ));
        }

        let program = command_parts[0];
        let args = &command_parts[1..];

        // Build and execute the command with timeout
        let child = Command::new(program)
            .args(args)
            .current_dir(workspace)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                BenchError::VerificationError(format!(
                    "Failed to spawn verification command: {}",
                    e
                ))
            })?;

        let output = match timeout(timeout_duration, child.wait_with_output()).await {
            Ok(result) => result.map_err(|e| {
                BenchError::VerificationError(format!("Verification command failed: {}", e))
            })?,
            Err(_) => {
                return Err(BenchError::Timeout(task.verification.timeout));
            }
        };

        let duration_secs = start.elapsed().as_secs_f64();

        Ok(VerificationResult {
            passed: output.status.success(),
            exit_code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            duration_secs,
        })
    }
}

/// Benchmark result for a single task run
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkResult {
    /// Task ID
    pub task_id: String,
    /// Agent name
    pub agent: String,
    /// Whether the task was completed successfully
    pub success: bool,
    /// Score (0-100)
    pub score: u32,
    /// Number of iterations/attempts
    pub iterations: u32,
    /// Token usage (if available)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_used: Option<u64>,
    /// Total duration in seconds
    pub duration_secs: f64,
    /// Verification output
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_output: Option<String>,
    /// Agent output
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_output: Option<String>,
    /// Timestamp when the run started
    pub timestamp: DateTime<Utc>,
    /// Error message if failed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl BenchmarkResult {
    /// Create a successful result
    pub fn success(
        task_id: String,
        agent: String,
        iterations: u32,
        tokens_used: Option<u64>,
        duration_secs: f64,
    ) -> Self {
        // TODO the score should create by the verification result
        Self {
            task_id,
            agent,
            success: true,
            score: 100,
            iterations,
            tokens_used,
            duration_secs,
            verification_output: None,
            agent_output: None,
            timestamp: Utc::now(),
            error: None,
        }
    }

    /// Create a failed result
    pub fn failure(
        task_id: String,
        agent: String,
        iterations: u32,
        tokens_used: Option<u64>,
        duration_secs: f64,
        error: String,
    ) -> Self {
        Self {
            task_id,
            agent,
            success: false,
            score: 0,
            iterations,
            tokens_used,
            duration_secs,
            verification_output: None,
            agent_output: None,
            timestamp: Utc::now(),
            error: Some(error),
        }
    }

    /// Add verification output to the result
    pub fn with_verification_output(mut self, output: String) -> Self {
        self.verification_output = Some(output);
        self
    }

    /// Add agent output to the result
    pub fn with_agent_output(mut self, output: String) -> Self {
        self.agent_output = Some(output);
        self
    }

    /// Save result to a JSON file
    pub fn save(&self, results_dir: &Path) -> Result<std::path::PathBuf> {
        std::fs::create_dir_all(results_dir)?;

        let filename = format!(
            "{}_{}_{}_{}.json",
            self.task_id,
            self.agent,
            self.timestamp.format("%Y%m%d_%H%M%S"),
            if self.success { "pass" } else { "fail" }
        );
        let path = results_dir.join(filename);

        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(&path, json)?;

        Ok(path)
    }
}

/// Suite results containing multiple benchmark results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuiteResults {
    /// Agent name
    pub agent: String,
    /// Individual task results
    pub results: Vec<BenchmarkResult>,
    /// Total tasks
    pub total_tasks: usize,
    /// Passed tasks
    pub passed: usize,
    /// Failed tasks
    pub failed: usize,
    /// Overall pass rate (0.0 - 1.0)
    pub pass_rate: f64,
    /// Total duration in seconds
    pub total_duration_secs: f64,
    /// Timestamp when suite started
    pub timestamp: DateTime<Utc>,
}

impl SuiteResults {
    /// Create suite results from individual benchmark results
    pub fn from_results(agent: String, results: Vec<BenchmarkResult>) -> Self {
        let total_tasks = results.len();
        let passed = results.iter().filter(|r| r.success).count();
        let failed = total_tasks - passed;
        let pass_rate = if total_tasks > 0 {
            passed as f64 / total_tasks as f64
        } else {
            0.0
        };
        let total_duration_secs: f64 = results.iter().map(|r| r.duration_secs).sum();

        Self {
            agent,
            results,
            total_tasks,
            passed,
            failed,
            pass_rate,
            total_duration_secs,
            timestamp: Utc::now(),
        }
    }

    /// Save suite results to a JSON file
    pub fn save(&self, results_dir: &Path) -> Result<std::path::PathBuf> {
        std::fs::create_dir_all(results_dir)?;

        let filename = format!(
            "suite_{}_{}.json",
            self.agent,
            self.timestamp.format("%Y%m%d_%H%M%S")
        );
        let path = results_dir.join(filename);

        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(&path, json)?;

        Ok(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_benchmark_result_success() {
        let result = BenchmarkResult::success(
            "TEST-001".to_string(),
            "claude".to_string(),
            1,
            Some(1000),
            5.5,
        );

        assert!(result.success);
        assert_eq!(result.score, 100);
        assert_eq!(result.iterations, 1);
    }

    #[test]
    fn test_benchmark_result_failure() {
        let result = BenchmarkResult::failure(
            "TEST-001".to_string(),
            "claude".to_string(),
            3,
            Some(3000),
            15.0,
            "Tests failed".to_string(),
        );

        assert!(!result.success);
        assert_eq!(result.score, 0);
        assert_eq!(result.error, Some("Tests failed".to_string()));
    }

    #[test]
    fn test_suite_results() {
        let results = vec![
            BenchmarkResult::success("T1".into(), "claude".into(), 1, None, 1.0),
            BenchmarkResult::failure("T2".into(), "claude".into(), 1, None, 1.0, "error".into()),
            BenchmarkResult::success("T3".into(), "claude".into(), 1, None, 1.0),
        ];

        let suite = SuiteResults::from_results("claude".into(), results);

        assert_eq!(suite.total_tasks, 3);
        assert_eq!(suite.passed, 2);
        assert_eq!(suite.failed, 1);
        assert!((suite.pass_rate - 0.666).abs() < 0.01);
    }
}
