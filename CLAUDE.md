# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Agent Bench is an open-source benchmark for evaluating AI coding agents on real-world engineering tasks. It creates reproducible evaluation environments derived from authentic development tasks.

## Tech Stack

- **Language**: Python 3.11+
- **Package Manager**: uv (fast Python package installer and resolver)
- **Build System**: pyproject.toml

## Build Commands

```bash
# Install dependencies
uv sync

# Run the CLI
uv run agent-bench <command>

# Run tests
uv run pytest

# Run with debug output
uv run agent-bench --debug <command>
```

## Project Structure

```
agent-bench/
├── src/
│   └── agent_bench/
│       ├── __init__.py
│       ├── cli.py          # Command-line interface
│       ├── task.py         # Task model and loader
│       ├── runner.py       # Task execution
│       ├── collect_results.py  # Results aggregation
│       ├── agents/         # Agent adapters
│       │   ├── __init__.py
│       │   └── claude.py
│       └── evaluator.py    # Result verification
├── tasks/                  # Benchmark tasks (YAML format)
│   └── examples/
├── results/                # Run outputs
├── pyproject.toml          # Project configuration and dependencies
└── uv.lock                 # Locked dependency versions
```

## CLI Usage

```bash
# List available tasks
agent-bench list

# Run a specific task
agent-bench run --task <task-id> --agent <agent-name>

# Run full benchmark suite
agent-bench run --suite all --agent <agent-name>

# Collect results into CSV
agent-bench collect                    # Creates results/summary.csv
agent-bench collect -o output.csv      # Custom output path
```

## Task Format

Tasks are defined in YAML with the following structure:
- `id`: Unique identifier (e.g., BUG-001)
- `title`: Brief description
- `category`: Task type (bug-fix, feature, refactor)
- `difficulty`: easy, medium, hard
- `source`: Repository URL and commit hash
- `prompt`: Task instructions for the agent
- `verification`: Test command and timeout
- `permissions`: Agent permissions configuration (optional)
  - `mode`: Permission mode - "dontAsk" (auto-approve), "bypassPermissions" (skip checks), "default" (ask each time)
  - `write`: Allow Write and Edit tools (default: false)
  - `read`: Allow Read, Glob, and Grep tools (default: true)
  - `bash`: Allow Bash tool (default: false)
  - `web_fetch`: Allow WebFetch and WebSearch tools (default: false)
- `metadata`: Tags for categorization

### Example Task with Permissions

```yaml
id: TOOLS-001
title: "Find system OS version"
category: tools
difficulty: easy
source:
  repository: https://github.com/jiahaoxiang2000/agent-bench.git
  commit: "main"
prompt: |
  Use system tools to find the operating system version and save the result.
  Write the OS version to a file: results/os_version.txt
verification:
  type: python
  command: "python tests/verify_os_version.py"
  timeout: 30
permissions:
  mode: "dontAsk"  # Auto-approve all permissions
  write: true      # Allow Write and Edit tools
  bash: true       # Allow Bash tool
  read: true       # Allow Read, Glob, Grep tools
  web_fetch: false # Disallow WebFetch and WebSearch tools
metadata:
  tags:
    - system-info
    - tools
```

## Architecture

```
CLI → Core (Task Loader, Runner) → Agent Adapter → Evaluator (Verifier, Results)
```

## Key Metrics

- **Score**: 0-100 scale measuring solution quality and completeness
- **Iterations**: Attempts before success
- **Token Usage**: Tokens consumed
- **Duration**: Time to completion

## Development Status

MVP phase focusing on:
- Task loader and validator
- Single agent adapter (Claude)
- Basic runner (local execution)
- Test-based verification
- JSON results output

## Important Reminders

- **When completing a TODO item**: Update `TODO.md` to mark the item as done by changing `- [ ]` to `- [x]`
