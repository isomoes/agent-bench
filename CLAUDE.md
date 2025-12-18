# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Agent Bench is an open-source benchmark for evaluating AI coding agents on real-world engineering tasks. It creates reproducible evaluation environments derived from authentic development tasks.

## Tech Stack

- **Language**: TypeScript
- **Runtime**: Bun (fast JavaScript runtime)
- **Agent SDK**: OpenCode SDK (@opencode-ai/sdk)
- **CLI Framework**: Commander.js

## Build Commands

```bash
# Install dependencies
bun install

# Run the CLI (development)
bun run src/index.ts <command>

# Build for production
bun run build

# Type check
bun run typecheck

# Run with debug output
bun run src/index.ts --debug <command>
```

## Project Structure

```
agent-bench/
├── src/
│   ├── index.ts           # CLI entry point
│   ├── cli/
│   │   ├── index.ts       # Commander.js setup
│   │   └── commands/      # CLI commands
│   │       ├── list.ts    # List tasks
│   │       ├── run.ts     # Run tasks
│   │       ├── collect.ts # Collect results
│   │       ├── verify.ts  # Manual verification
│   │       └── init.ts    # Initialize config
│   ├── core/
│   │   ├── task.ts        # Task models (Zod schemas)
│   │   ├── loader.ts      # YAML task loader
│   │   ├── runner.ts      # Task execution orchestrator
│   │   ├── workspace.ts   # Git workspace management
│   │   └── config.ts      # Configuration management
│   ├── agents/
│   │   ├── types.ts       # Agent interfaces
│   │   ├── opencode.ts    # OpenCode SDK adapter
│   │   └── factory.ts     # Agent factory
│   ├── evaluator/
│   │   ├── verifier.ts    # Subprocess verification
│   │   └── results.ts     # Result models + persistence
│   ├── collectors/
│   │   └── csv.ts         # JSON → CSV aggregation
│   └── utils/
│       ├── logger.ts      # Colored logging
│       └── errors.ts      # Custom error classes
├── tasks/                  # Benchmark tasks (YAML format)
├── results/                # Run outputs (JSON + CSV)
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
└── bunfig.toml             # Bun configuration
```

## CLI Usage

```bash
# List available tasks
bun run src/index.ts list
bun run src/index.ts list --category bug-fix        # Filter by category
bun run src/index.ts list --difficulty easy         # Filter by difficulty
bun run src/index.ts list --tags tools,python       # Filter by tags
bun run src/index.ts list --verbose                 # Show full details

# Run a specific task
bun run src/index.ts run -t <task-id>
bun run src/index.ts run -t TOOLS-001 -m anthropic/claude-opus-4

# Run task suites
bun run src/index.ts run -s all                     # Run all tasks
bun run src/index.ts run -s bug-fix                 # Run category
bun run src/index.ts run -t TOOLS-001 --no-verify  # Skip verification

# Collect results into CSV
bun run src/index.ts collect                        # Creates results/summary.csv
bun run src/index.ts collect -o output.csv          # Custom output path

# Manual verification
bun run src/index.ts verify -t TOOLS-001 -w /path/to/workspace

# Initialize configuration
bun run src/index.ts init --default-model anthropic/claude-sonnet-4-5
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
- `max_iterations`: Maximum number of agent turns/iterations (optional, defaults to 20)
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
  mode: "dontAsk" # Auto-approve all permissions
  write: true # Allow Write and Edit tools
  bash: true # Allow Bash tool
  read: true # Allow Read, Glob, Grep tools
  web_fetch: false # Disallow WebFetch and WebSearch tools
max_iterations: 10 # Optional: limit agent to 10 turns (defaults to 20)
metadata:
  tags:
    - system-info
    - tools
```

## Architecture

```
CLI (Commander.js) → Runner → OpenCode Agent → OpenCode SDK → Verifier → Results (JSON/CSV)
  ↓                     ↓                           ↓
TaskLoader       WorkspaceManager           SSE Event Stream
  ↓                     ↓                           ↓
Zod Validation    Git Operations            Metrics Collection
```

**Key Components:**
- **CLI**: Commander.js-based interface with enhanced filtering and options
- **TaskLoader**: YAML parsing with Zod runtime validation
- **WorkspaceManager**: Git repository cloning and workspace isolation
- **OpenCodeAgent**: OpenCode SDK adapter with SSE event streaming for metrics
- **Verifier**: Subprocess-based verification with timeout handling
- **Results**: JSON + CSV output with benchmark metrics

## Key Metrics

- **Score**: 0-100 scale measuring solution quality and completeness
- **Iterations**: Attempts before success
- **Token Usage**: Tokens consumed
- **Duration**: Time to completion
