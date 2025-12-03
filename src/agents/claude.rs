use async_trait::async_trait;
use std::path::Path;
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

    /// Apply permission flags to the command
    fn apply_permissions(cmd: &mut Command, task: &Task) {
        let perms = &task.permissions;

        // Set permission mode if specified
        if let Some(mode) = &perms.mode {
            cmd.arg("--permission-mode").arg(mode);
        } else {
            // Default to dontAsk if any permissions are enabled
            if perms.write || perms.bash || perms.web_fetch {
                cmd.arg("--permission-mode").arg("dontAsk");
            }
        }

        // Build allowed tools list
        let mut allowed_tools = Vec::new();

        // Read is typically always allowed
        if perms.read {
            allowed_tools.push("Read");
            allowed_tools.push("Glob");
            allowed_tools.push("Grep");
        }

        if perms.write {
            allowed_tools.push("Write");
            allowed_tools.push("Edit");
        }

        if perms.bash {
            allowed_tools.push("Bash");
        }

        if perms.web_fetch {
            allowed_tools.push("WebFetch");
            allowed_tools.push("WebSearch");
        }

        // Add allowed tools if any are specified
        if !allowed_tools.is_empty() {
            cmd.arg("--allowedTools").arg(allowed_tools.join(","));
        }
    }

    /// Get permission flags as a string for logging
    fn get_permission_flags(task: &Task) -> String {
        let perms = &task.permissions;
        let mut flags = Vec::new();

        // Add permission mode
        if let Some(mode) = &perms.mode {
            flags.push(format!("--permission-mode {}", mode));
        } else if perms.write || perms.bash || perms.web_fetch {
            flags.push("--permission-mode dontAsk".to_string());
        }

        // Build allowed tools list for display
        let mut allowed_tools = Vec::new();

        if perms.read {
            allowed_tools.extend(["Read", "Glob", "Grep"]);
        }
        if perms.write {
            allowed_tools.extend(["Write", "Edit"]);
        }
        if perms.bash {
            allowed_tools.push("Bash");
        }
        if perms.web_fetch {
            allowed_tools.extend(["WebFetch", "WebSearch"]);
        }

        if !allowed_tools.is_empty() {
            flags.push(format!("--allowedTools '{}'", allowed_tools.join(",")));
        }

        flags.join(" ")
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

            let mut cmd = Command::new("claude");
            cmd.current_dir(workspace);

            // Close stdin to prevent the command from waiting for input
            cmd.stdin(std::process::Stdio::null());

            // Add permission flags based on task configuration
            Self::apply_permissions(&mut cmd, task);

            // Add the prompt with -p flag (closes prompt)
            cmd.arg("-p");
            cmd.arg(&task.prompt);

            let perm_flags = Self::get_permission_flags(task);
            let command_str = if perm_flags.is_empty() {
                format!("claude -p '{}'", task.prompt)
            } else {
                format!("claude {} -p '{}'", perm_flags, task.prompt)
            };
            log::debug!("Executing: {}", command_str);
            log::debug!("Working directory: {}", workspace.display());
            log::debug!("Prompt length: {} bytes", task.prompt.len());
            log::debug!("Full prompt: {}", task.prompt);

            // Add a timeout to help debug hanging issues
            let output = tokio::time::timeout(
                std::time::Duration::from_secs(300), // 5 minute timeout
                cmd.output(),
            )
            .await
            .map_err(|_| {
                BenchError::AgentError("Claude CLI command timed out after 300 seconds".to_string())
            })?
            .map_err(|e| BenchError::AgentError(format!("Failed to execute claude CLI: {}", e)))?;

            log::debug!("Command exit status: {}", output.status);
            log::debug!("Exit code: {:?}", output.status.code());

            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();

            log::debug!("STDOUT length: {} bytes", stdout.len());
            log::debug!("STDERR length: {} bytes", stderr.len());
            if !stdout.is_empty() {
                log::debug!("STDOUT:\n{}", stdout);
            }
            if !stderr.is_empty() {
                log::debug!("STDERR:\n{}", stderr);
            }

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
            cmd.current_dir(workspace);

            // Close stdin to prevent the command from waiting for input
            cmd.stdin(std::process::Stdio::null());

            // Add permission flags based on task configuration
            Self::apply_permissions(&mut cmd, task);

            // For first iteration, provide the initial prompt as argument
            // For subsequent iterations, use --continue with a prompt
            let (command_str, prompt_content) = if i == 0 {
                let perm_flags = Self::get_permission_flags(task);
                let cmd_str = if perm_flags.is_empty() {
                    "claude -p <prompt>".to_string()
                } else {
                    format!("claude {} -p <prompt>", perm_flags)
                };
                (cmd_str, task.prompt.clone())
            } else {
                cmd.arg("--continue");
                let perm_flags = Self::get_permission_flags(task);
                let cmd_str = if perm_flags.is_empty() {
                    "claude --continue -p <prompt>".to_string()
                } else {
                    format!("claude {} --continue -p <prompt>", perm_flags)
                };
                (
                    cmd_str,
                    "Please continue with the task. Check if verification passes. If there are errors, fix them and retry.".to_string()
                )
            };

            // Add prompt with -p flag as the last arguments
            cmd.arg("-p");
            cmd.arg(&prompt_content);

            log::debug!("Executing (iteration {}): {}", i + 1, command_str);
            log::debug!("Working directory: {}", workspace.display());
            log::debug!(
                "Prompt length (iteration {}): {} bytes",
                i + 1,
                prompt_content.len()
            );
            log::debug!("Full prompt (iteration {}): {}", i + 1, prompt_content);

            let output = cmd.output().await.map_err(|e| {
                BenchError::AgentError(format!(
                    "Failed to execute claude CLI (iteration {}): {}",
                    i + 1,
                    e
                ))
            })?;

            log::debug!(
                "Command exit status (iteration {}): {}",
                i + 1,
                output.status
            );
            log::debug!("Exit code (iteration {}): {:?}", i + 1, output.status.code());

            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();

            log::debug!("STDOUT length (iteration {}): {} bytes", i + 1, stdout.len());
            log::debug!("STDERR length (iteration {}): {} bytes", i + 1, stderr.len());
            if !stdout.is_empty() {
                log::debug!("STDOUT (iteration {}):\n{}", i + 1, stdout);
            }
            if !stderr.is_empty() {
                log::debug!("STDERR (iteration {}):\n{}", i + 1, stderr);
            }

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
