"""Claude Code CLI agent adapter."""

import asyncio
import logging
from pathlib import Path
from typing import List

from ..error import AgentError
from ..task import Task
from .base import Agent, AgentResult

logger = logging.getLogger(__name__)


class ClaudeAgent(Agent):
    """Claude Code CLI agent adapter."""

    def __init__(self, max_iterations: int = 1, cli_command: str = "claude", display_name: str = "claude"):
        self.max_iterations = max_iterations
        self.cli_command = cli_command
        self.display_name = display_name

    def name(self) -> str:
        """Get the agent's name."""
        return self.display_name

    async def execute(self, task: Task, workspace: Path) -> AgentResult:
        """Execute a task in the given workspace."""
        iterations = 0
        last_output = ""

        # For single iteration, use -p mode for one-shot execution
        if self.max_iterations == 1:
            iterations = 1

            cmd = [self.cli_command]
            self._apply_permissions(cmd, task)
            cmd.extend(["-p", task.prompt])

            perm_flags = self._get_permission_flags(task)
            command_str = (
                f"{self.cli_command} {perm_flags} -p '{task.prompt}'"
                if perm_flags
                else f"{self.cli_command} -p '{task.prompt}'"
            )

            logger.debug(f"Executing: {command_str}")
            logger.debug(f"Working directory: {workspace}")

            try:
                process = await asyncio.create_subprocess_exec(
                    *cmd,
                    cwd=str(workspace),
                    stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )

                # Add timeout
                stdout_bytes, stderr_bytes = await asyncio.wait_for(
                    process.communicate(), timeout=300  # 5 minute timeout
                )

                exit_code = process.returncode
                stdout = stdout_bytes.decode("utf-8", errors="replace")
                stderr = stderr_bytes.decode("utf-8", errors="replace")

                logger.debug(f"Command exit status: {exit_code}")
                logger.debug(f"STDOUT length: {len(stdout)} bytes")
                logger.debug(f"STDERR length: {len(stderr)} bytes")

                if stdout:
                    logger.debug(f"STDOUT:\n{stdout}")
                if stderr:
                    logger.debug(f"STDERR:\n{stderr}")

                last_output = f"{stdout}\n\nSTDERR:\n{stderr}" if stderr else stdout

                return AgentResult(
                    success=(exit_code == 0),
                    output=last_output,
                    iterations=iterations,
                    tokens_used=None,
                )

            except asyncio.TimeoutError:
                raise AgentError(f"{self.cli_command} command timed out after 300 seconds")
            except Exception as e:
                raise AgentError(f"Failed to execute {self.cli_command}: {e}")

        # For multiple iterations, use conversational mode with --continue
        for i in range(self.max_iterations):
            iterations += 1

            cmd = [self.cli_command]
            self._apply_permissions(cmd, task)

            if i == 0:
                prompt_content = task.prompt
                perm_flags = self._get_permission_flags(task)
                command_str = (
                    f"{self.cli_command} {perm_flags} -p <prompt>" if perm_flags else f"{self.cli_command} -p <prompt>"
                )
            else:
                cmd.append("--continue")
                prompt_content = "Please continue with the task. Check if verification passes. If there are errors, fix them and retry."
                perm_flags = self._get_permission_flags(task)
                command_str = (
                    f"{self.cli_command} {perm_flags} --continue -p <prompt>"
                    if perm_flags
                    else f"{self.cli_command} --continue -p <prompt>"
                )

            cmd.extend(["-p", prompt_content])

            logger.debug(f"Executing (iteration {i + 1}): {command_str}")
            logger.debug(f"Working directory: {workspace}")
            logger.debug(f"Prompt length (iteration {i + 1}): {len(prompt_content)} bytes")
            logger.debug(f"Full prompt (iteration {i + 1}): {prompt_content}")

            try:
                process = await asyncio.create_subprocess_exec(
                    *cmd,
                    cwd=str(workspace),
                    stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )

                stdout_bytes, stderr_bytes = await process.communicate()

                exit_code = process.returncode
                stdout = stdout_bytes.decode("utf-8", errors="replace")
                stderr = stderr_bytes.decode("utf-8", errors="replace")

                logger.debug(f"Command exit status (iteration {i + 1}): {exit_code}")
                logger.debug(f"STDOUT length (iteration {i + 1}): {len(stdout)} bytes")
                logger.debug(f"STDERR length (iteration {i + 1}): {len(stderr)} bytes")

                if stdout:
                    logger.debug(f"STDOUT (iteration {i + 1}):\n{stdout}")
                if stderr:
                    logger.debug(f"STDERR (iteration {i + 1}):\n{stderr}")

                last_output = f"{stdout}\n\nSTDERR:\n{stderr}" if stderr else stdout

                # Check if the task succeeded
                if exit_code == 0 and "DONE" in last_output:
                    return AgentResult(
                        success=True,
                        output=last_output,
                        iterations=iterations,
                        tokens_used=None,
                    )

                # Small delay between iterations to avoid rate limiting
                if i < self.max_iterations - 1:
                    await asyncio.sleep(2)

            except Exception as e:
                raise AgentError(f"Failed to execute {self.cli_command} (iteration {i + 1}): {e}")

        return AgentResult(
            success=False,
            output=last_output,
            iterations=iterations,
            tokens_used=None,
        )

    def _apply_permissions(self, cmd: List[str], task: Task) -> None:
        """Apply permission flags to the command."""
        perms = task.permissions

        # Set permission mode if specified
        if perms.mode:
            cmd.extend(["--permission-mode", perms.mode])
        elif perms.write or perms.bash or perms.web_fetch:
            # Default to dontAsk if any permissions are enabled
            cmd.extend(["--permission-mode", "dontAsk"])

        # Build allowed tools list
        allowed_tools = []

        # Read is typically always allowed
        if perms.read:
            allowed_tools.extend(["Read", "Glob", "Grep"])

        if perms.write:
            allowed_tools.extend(["Write", "Edit"])

        if perms.bash:
            allowed_tools.append("Bash")

        if perms.web_fetch:
            allowed_tools.extend(["WebFetch", "WebSearch"])

        # Add allowed tools if any are specified
        if allowed_tools:
            cmd.extend(["--allowedTools", ",".join(allowed_tools)])

    def _get_permission_flags(self, task: Task) -> str:
        """Get permission flags as a string for logging."""
        perms = task.permissions
        flags = []

        # Add permission mode
        if perms.mode:
            flags.append(f"--permission-mode {perms.mode}")
        elif perms.write or perms.bash or perms.web_fetch:
            flags.append("--permission-mode dontAsk")

        # Build allowed tools list for display
        allowed_tools = []

        if perms.read:
            allowed_tools.extend(["Read", "Glob", "Grep"])
        if perms.write:
            allowed_tools.extend(["Write", "Edit"])
        if perms.bash:
            allowed_tools.append("Bash")
        if perms.web_fetch:
            allowed_tools.extend(["WebFetch", "WebSearch"])

        if allowed_tools:
            flags.append(f"--allowedTools '{','.join(allowed_tools)}'")

        return " ".join(flags)
