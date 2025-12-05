"""Claude Agent SDK adapter for benchmarking."""

import logging
import os
from pathlib import Path
from typing import Dict, List, Optional

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolUseBlock,
    query,
)

from ..error import AgentError
from ..task import Task
from .base import Agent, AgentResult

logger = logging.getLogger(__name__)


class ClaudeSDKAgent(Agent):
    """Claude Agent SDK adapter for benchmarking."""

    def __init__(
        self,
        display_name: str = "claude-sdk",
        model: Optional[str] = None,
        env_vars: Optional[Dict[str, str]] = None,
        max_iterations: int = 20,
        enable_web_search: bool = False,
    ):
        self.display_name = display_name
        self.model = model
        self.env_vars = env_vars or {}
        self.max_iterations = max_iterations
        self.enable_web_search = enable_web_search
        self._version: Optional[str] = None
        self._model_name: Optional[str] = None

    def name(self) -> str:
        """Get the agent's name."""
        return self.display_name

    async def execute(self, task: Task, workspace: Path) -> AgentResult:
        """Execute a task in the given workspace using Claude Agent SDK."""
        # Set environment variables
        original_env = os.environ.copy()
        try:
            os.environ.update(self.env_vars)

            # Get model name from env or use provided
            self._model_name = self._get_model_name()

            # Build allowed tools list from task permissions
            allowed_tools = self._build_allowed_tools(task)

            # Use task's max_iterations if specified, otherwise use agent default
            max_turns = task.max_iterations if task.max_iterations is not None else self.max_iterations

            # Create SDK options
            options = ClaudeAgentOptions(
                allowed_tools=allowed_tools,
                permission_mode="bypassPermissions",  # Auto-approve for benchmarking
                cwd=workspace,
                max_turns=max_turns,
                model=self.model or self._model_name,
                include_partial_messages=False,
                system_prompt=f"You are working in the directory: {workspace}\n"
                f"All relative file paths should be relative to this working directory.\n"
                f"When instructed to create files with relative paths like 'results/file.txt', "
                f"create them in the current working directory, not in your home directory.",
            )

            # Execute the task
            iterations = 0
            duration_ms = 0
            total_cost_usd = 0.0
            output_lines = []
            input_tokens = 0
            output_tokens = 0
            success = False

            logger.debug(f"Executing task with SDK: {task.prompt[:100]}...")
            logger.debug(f"Working directory: {workspace}")
            logger.debug(f"Allowed tools: {allowed_tools}")
            logger.debug(f"Model: {options.model}")

            try:
                async for message in query(prompt=task.prompt, options=options):
                    if isinstance(message, AssistantMessage):
                        # Collect assistant output
                        for block in message.content:
                            if isinstance(block, TextBlock):
                                output_lines.append(f"Assistant: {block.text}")
                            elif isinstance(block, ThinkingBlock):
                                output_lines.append(f"Thinking: {block.thinking}")
                            elif isinstance(block, ToolUseBlock):
                                output_lines.append(f"Tool {block.name}: {block.input}")

                    elif isinstance(message, SystemMessage):
                        output_lines.append(f"System [{message.subtype}]: {message.data}")

                    elif isinstance(message, ResultMessage):
                        # Capture final metrics
                        iterations = message.num_turns
                        duration_ms = message.duration_ms
                        total_cost_usd = message.total_cost_usd or 0.0
                        success = not message.is_error

                        if message.usage:
                            input_tokens = message.usage.get("input_tokens", 0)
                            output_tokens = message.usage.get("output_tokens", 0)

                        logger.debug(
                            f"Task completed: {iterations} turns, {duration_ms}ms, ${total_cost_usd:.4f}"
                        )
                        logger.debug(f"Tokens: {input_tokens} input, {output_tokens} output")

                output = "\n".join(output_lines)
                total_tokens = input_tokens + output_tokens

                # Get version info (cached)
                if not self._version:
                    self._version = await self._get_version()

                return AgentResult(
                    success=success,
                    output=output,
                    iterations=iterations,
                    tokens_used=total_tokens if total_tokens > 0 else None,
                    agent_version=self._version,
                    model_name=self._model_name,
                )

            except Exception as e:
                logger.error(f"SDK execution failed: {e}", exc_info=True)
                raise AgentError(f"Failed to execute task with SDK: {e}")

        finally:
            # Restore original environment
            os.environ.clear()
            os.environ.update(original_env)

    async def _get_version(self) -> Optional[str]:
        """Get Claude SDK version."""
        try:
            import claude_agent_sdk

            return f"claude-agent-sdk {claude_agent_sdk.__version__}"
        except Exception as e:
            logger.warning(f"Failed to get SDK version: {e}")
            return "claude-agent-sdk (unknown version)"

    def _get_model_name(self) -> str:
        """Get model name from environment variables or config."""
        # Check custom env_vars first
        if "ANTHROPIC_MODEL" in self.env_vars:
            return self.env_vars["ANTHROPIC_MODEL"]
        elif "ANTHROPIC_DEFAULT_SONNET_MODEL" in self.env_vars:
            return self.env_vars["ANTHROPIC_DEFAULT_SONNET_MODEL"]

        # Then check system environment
        if "ANTHROPIC_MODEL" in os.environ:
            return os.environ["ANTHROPIC_MODEL"]
        elif "ANTHROPIC_DEFAULT_SONNET_MODEL" in os.environ:
            return os.environ["ANTHROPIC_DEFAULT_SONNET_MODEL"]

        # Default to standard Claude model
        return "claude-sonnet-4-5"

    def _build_allowed_tools(self, task: Task) -> List[str]:
        """Build list of allowed tools from task permissions."""
        tools = []

        perms = task.permissions

        # Read tools (typically always allowed)
        if perms.read:
            tools.extend(["Read", "Glob", "Grep"])

        # Write tools
        if perms.write:
            tools.extend(["Write", "Edit"])

        # Bash tool
        if perms.bash:
            tools.append("Bash")

        # Web tools
        if perms.web_fetch or self.enable_web_search:
            tools.extend(["WebFetch", "WebSearch"])

        return tools
