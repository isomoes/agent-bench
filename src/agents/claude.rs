use async_trait::async_trait;
use std::path::Path;
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::error::{BenchError, Result};
use crate::task::Task;

use super::{Agent, AgentResult};

/// Claude Code CLI agent adapter
pub struct ClaudeAgent {
    /// Maximum iterations for the agent
    max_iterations: u32,
}

impl ClaudeAgent {
    /// Create a new Claude agent
    pub fn new() -> Self {
        Self { max_iterations: 1 }
    }

    /// Create a new Claude agent with custom max iterations
    pub fn with_max_iterations(max_iterations: u32) -> Self {
        Self { max_iterations }
    }
}

impl Default for ClaudeAgent {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Agent for ClaudeAgent {
    fn name(&self) -> &str {
        "claude"
    }

    async fn execute(&self, task: &Task, workspace: &Path) -> Result<AgentResult> {
        let mut iterations = 0;
        let mut last_output = String::new();

        // For single iteration, use --print mode for one-shot execution
        if self.max_iterations == 1 {
            iterations = 1;

            let output = Command::new("claude")
                .arg("--print")
                .arg(&task.prompt)
                .current_dir(workspace)
                .output()
                .await
                .map_err(|e| {
                    BenchError::AgentError(format!("Failed to execute claude CLI: {}", e))
                })?;

            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();

            last_output = if stderr.is_empty() {
                stdout
            } else {
                format!("{}\n\nSTDERR:\n{}", stdout, stderr)
            };

            return Ok(AgentResult {
                success: output.status.success(),
                output: last_output,
                iterations,
                tokens_used: None,
            });
        }

        // For multiple iterations, use conversational mode with --continue
        for i in 0..self.max_iterations {
            iterations += 1;

            let mut cmd = Command::new("claude");
            cmd.arg("--print").current_dir(workspace);

            // For first iteration, provide the initial prompt
            // For subsequent iterations, use --continue to resume conversation
            if i == 0 {
                cmd.arg(&task.prompt);
            } else {
                cmd.arg("--continue");
                cmd.arg("Please continue with the task. Check if verification passes. If there are errors, fix them and retry.");
            }

            let output = cmd.output().await.map_err(|e| {
                BenchError::AgentError(format!("Failed to execute claude CLI: {}", e))
            })?;

            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();

            last_output = if stderr.is_empty() {
                stdout
            } else {
                format!("{}\n\nSTDERR:\n{}", stdout, stderr)
            };

            // Check if the task succeeded (we could add more sophisticated checking here)
            if output.status.success() && last_output.contains("DONE") {
                return Ok(AgentResult {
                    success: true,
                    output: last_output,
                    iterations,
                    tokens_used: None,
                });
            }

            // Small delay between iterations to avoid rate limiting
            if i < self.max_iterations - 1 {
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
            }
        }

        Ok(AgentResult {
            success: false,
            output: last_output,
            iterations,
            tokens_used: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_claude_agent_creation() {
        let agent = ClaudeAgent::new();
        assert_eq!(agent.name(), "claude");
        assert_eq!(agent.max_iterations, 1);
    }

    #[test]
    fn test_claude_agent_with_iterations() {
        let agent = ClaudeAgent::with_max_iterations(3);
        assert_eq!(agent.max_iterations, 3);
    }
}
