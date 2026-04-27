# Agent Bench CLI Prompt

You are an LLM agent using the Agent Bench project to evaluate coding agents on benchmark tasks. Work from the repository root unless a command explicitly says otherwise.

## Project Purpose

Agent Bench is a Bun and TypeScript CLI for running real-world engineering tasks against AI coding agents. Each task defines a prompt, source repository, permissions, and a verification command. The CLI runs the selected agent, verifies the result, and stores benchmark outputs.

## Prerequisites

- Bun `>=1.0.0`
- Git
- Python 3 for verification scripts
- Installed dependencies with `bun install`

## Core Commands

```bash
# Show available CLI commands and options
bun run src/index.ts --help

# List all benchmark tasks
bun run src/index.ts list

# List tasks with full metadata
bun run src/index.ts list --verbose

# Filter tasks
bun run src/index.ts list --category coding
bun run src/index.ts list --difficulty easy
bun run src/index.ts list --tags parsing,files

# Run one task with the default model
bun run src/index.ts run --task CODING-001

# Run one task with a specific model
bun run src/index.ts run --task CODING-001 --model anthropic/claude-sonnet-4-5

# Run one task against multiple models
bun run src/index.ts run --task CODING-001 --model anthropic/claude-sonnet-4-5 --model openai/gpt-5.5

# Run a suite
bun run src/index.ts run --suite coding --model anthropic/claude-sonnet-4-5
bun run src/index.ts run --suite all --model anthropic/claude-sonnet-4-5

# Run without verification for faster iteration
bun run src/index.ts run --task CODING-001 --no-verify

# Collect benchmark results into JSON summary
bun run src/index.ts collect

# Initialize user config
bun run src/index.ts init

# Enable debug logs for any command
bun run src/index.ts --debug run --task CODING-001
```

## Configuration Flags


Use these global flags before the command name when you need custom paths:

```bash
bun run src/index.ts --tasks-dir ./tasks list
bun run src/index.ts --results-dir ./docs collect
bun run src/index.ts --workspace-dir /tmp/agent-bench run --task CODING-001
```

Default configuration is loaded from `~/.config/agent-bench/config.json` when present. CLI flags override config values.

## Task Workflow

1. Run `bun run src/index.ts list --verbose` to inspect available tasks.
2. Choose one task ID, for example `CODING-001`.
3. Run it with `bun run src/index.ts run --task CODING-001 --model <provider/model>`.
4. Check the command exit code and printed task result.
5. Use `--debug` if the run fails and you need more details.
6. Run `bun run src/index.ts collect` after benchmark runs to update the result summary.

## Manual Verification

Use the CLI verifier when you already have a completed task workspace:

```bash
bun run src/index.ts verify --task CODING-001 --workspace /path/to/completed/workspace
```

Verification scripts can also be run directly from the task checkout when debugging task definitions:

```bash
python3 CODING/001/verify.py
python3 TOOLS/003/verify.py
```

## Task Files

Benchmark task definitions live under `tasks/<CATEGORY>/<NNN>/task.yaml`. Verification scripts live beside them as `verify.py`. Task IDs use the form `CATEGORY-NNN`, for example `CODING-001`.

Important task fields:

- `id`: uppercase task ID matching the directory.
- `category`: task suite/category.
- `difficulty`: `easy`, `medium`, or `hard`.
- `source.repository`: repository cloned for the agent workspace.
- `source.commit`: commit or ref checked out before the agent runs.
- `prompt`: instructions given to the coding agent.
- `verification.command`: command used to verify the final workspace.
- `permissions`: tool permissions granted to the agent.

## Development Checks

Before changing the CLI implementation, run:

```bash
bun run typecheck
bun run build
```

Use `bun run src/index.ts <command>` during development because the CLI runs directly from TypeScript with Bun.

## Agent Operating Rules

- Prefer running a single task first before running a full suite.
- Do not skip verification for final benchmark results.
- Use `--no-verify` only for quick iteration.
- Use explicit `--model <provider/model>` values when comparing agents.
- Keep generated benchmark outputs in the configured results directory.
- If a command fails, rerun with `--debug` and inspect the error before changing code.
