# Orchestrator MCP Server - Architecture

## Overview

The Autonomous Orchestration MCP Server is a Model Context Protocol (MCP) server that manages AI-assisted code generation workflows. It breaks down complex goals into atomic tasks, enforces bounded contexts, tracks progress, and maintains quality gates.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Orchestrator MCP Server                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │    MCP      │  │   Server    │  │      Transports         │ │
│  │   Layer     │  │   Core      │  │    (stdio, etc.)        │ │
│  └──────┬──────┘  └──────┬──────┘  └─────────────────────────┘ │
│         │                │                                      │
│  ┌──────▼────────────────▼────────────────────────────────────┐ │
│  │                    Orchestrator Core                        │ │
│  │              (State Machine + Coordination)                 │ │
│  └──────┬──────────────────────────────────────────────────────┘ │
│         │                                                        │
│  ┌──────▼──────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │   State Manager     │  │  Gap Analyzer │  │ Roadmap Generator│ │
│  │  - Persistence      │  │  - Parser     │  │  - Decomposer    │ │
│  │  - Journaling       │  │  - Detector   │  │  - Scheduler     │ │
│  │  - Recovery         │  │  - AST Verifier│  │  - Phaser        │ │
│  └─────────────────────┘  └──────────────┘  └─────────────────┘ │
│  ┌─────────────────────┐  ┌──────────────────────────────────┐ │
│  │  Context Injector   │  │     Execution Sandbox            │ │
│  │  - File Scorer      │  │     - Command Runner             │ │
│  │  - Assembler        │  │     - Error Parsers              │ │
│  │  - Vector Store     │  │     - Docker Integration         │ │
│  └─────────────────────┘  └──────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              Scoring Engine                                  │ │
│  │  - Requirements Coverage  - Test Pass Rate                   │ │
│  │  - Code Quality           - Implementation Completeness      │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## State Machine

The orchestrator implements a 7-state state machine:

```
                    ┌──────────┐
         ┌─────────►│   IDLE   │◄────────────────┐
         │          └────┬─────┘                 │
         │               │ GOAL_INGESTED         │
         │               ▼                       │
         │          ┌──────────┐                 │
         │          │ ANALYZE  │                 │
         │          │  GAPS    │                 │
         │          └────┬─────┘                 │
         │               │ GAPS_DETECTED         │
         │               ▼                       │
         │          ┌──────────┐                 │
         │          │   PLAN   │                 │
         │          │ ROADMAP  │                 │
         │          └────┬─────┘                 │
         │               │ ROADMAP_CREATED       │
         │               ▼                       │
         │    ┌──────────────────────┐           │
         │    │   EXECUTE_SESSION    │◄──────────┤
         │    │  - Task Assignment   │           │
         │    │  - Task Execution    │           │
         │    └──────────┬───────────┘           │
         │               │                       │
         ▼               ▼                       │
    ┌──────────┐   ┌──────────┐                 │
    │  VERIFY  │◄──┤  SCORE   │─────────────────┤
    │  OUTPUT  │   │ PROJECT  │   (if score < 85)│
    └────┬─────┘   └────┬─────┘                 │
         │               │ SCORE_CALCULATED      │
         │               ▼ (score >= 85)         │
         │          ┌──────────┐                 │
         └─────────►│ COMPLETE │─────────────────┘
                    └──────────┘
                            (RESET to go back to IDLE)
```

## Core Subsystems

### 1. State Manager (`src/subsystems/state-manager/`)

Handles persistence, journaling, and recovery of orchestrator state.

**Key Components:**
- `persistence.ts` - Atomic writes, WAL (Write-Ahead Logging), checkpoint management, per-project isolation
- `journal.ts` - Write-ahead logging with entry cleanup
- `recovery.ts` - Multi-strategy crash recovery from journal and checkpoints

**Features:**
- Atomic state persistence with temp-file + rename pattern
- Journal-based recovery after crashes (3 strategies: state file, journal, checkpoint)
- Named checkpoints for rollback
- Automatic cleanup of old journal entries
- **Per-project state isolation** - Stores goal.md, gaps.json, score-history.json per project
- Secure file permissions (0o600/0o700) on state files
- Map and Date revival during deserialization

### 2. Gap Analyzer (`src/subsystems/gap-analyzer/`)

Analyzes the gap between current project state and desired goals.

**Key Components:**
- `parser.ts` - Parses natural language requirements using LLM or rule-based fallback
- `detector.ts` - Detects gaps between requirements and current implementation
- `ast-verifier.ts` - Deep symbol verification using ts-morph
- `semantic-analyzer.ts` - Code complexity and quality analysis

**Features:**
- LLM-powered requirement parsing (OpenAI, Anthropic, custom)
- Rule-based fallback for offline operation
- AST-based verification of function implementations
- Semantic code analysis with cyclomatic complexity

### 3. Roadmap Generator (`src/subsystems/roadmap-generator/`)

Generates execution roadmaps from detected gaps.

**Key Components:**
- `decomposer.ts` - Breaks gaps into tasks, builds dependency graph

**Features:**
- Task decomposition with dependency tracking
- Topological sort for correct execution order
- Phase assignment for milestone tracking
- Cycle detection in dependency graphs

### 4. Context Injector (`src/subsystems/context-injector/`)

Assembles bounded context for each task execution with multi-signal file scoring.

**Key Components:**
- `assembler.ts` - Calculates file relevance, assembles context, dependency graph analysis
- `file-scorer.ts` - 4-signal file relevance scoring
- `templates.ts` - Generates bounded context prompts
- `vector-store.ts` - LanceDB-backed semantic search with HuggingFace embeddings

**Features:**
- **4-signal file relevance scoring:**
  - Lexical matching (35%) - Keyword overlap
  - Semantic matching (35%) - Vector embeddings
  - Dependency distance (20%) - Import graph proximity
  - Historical cohesion (10%) - Files changed together
- Vector-based semantic search with `@xenova/transformers` embeddings
- Reactive vector indexing for large codebases
- **Targeted test identification** - Find tests related to modified files
- Dependency graph traversal (forward and reverse)
- Forbidden file enforcement with governance checks
- File reference extraction from task descriptions

### 5. Execution Sandbox (`src/subsystems/execution-sandbox/`)

Executes verification commands with Docker-based security isolation.

**Key Components:**
- `runner.ts` - Command execution with Docker sandboxing and output capture
- `detector.ts` - Project type detection for language-specific handling
- `parsers/` - Language-specific error parsers (TypeScript, Python, Rust, Go, ESLint, Generic)

**Security Features (Docker Sandbox):**
- **Copy-in/execution/copy-out** strategy for true file isolation
- `--network=none` - No network access
- `--read-only` - Read-only root filesystem  
- `--cap-drop=ALL` - Drop all Linux capabilities
- `--security-opt=no-new-privileges:true` - Prevent privilege escalation
- `--tmpfs` - Temporary directory in memory only
- Memory and CPU limits enforcement

**Features:**
- Multi-language test runner support (Vitest, Jest, Mocha, Pytest, Cargo, Go test, Maven)
- Docker containerization with security hardening
- Error parsing and structured output (parsedErrors, testResults, lintResults, typeResults)
- **Targeted test execution** - Only run tests affected by modified files
- Test result parsing for 6+ frameworks
- Timeout enforcement with graceful termination

### 6. Scoring Engine (`src/subsystems/scoring-engine/`)

Calculates project completion scores.

**Key Components:**
- `calculator.ts` - Score calculation with 4 components

**Scoring Components:**
1. Requirements Coverage (40%)
2. Test Pass Rate (30%)
3. Code Quality (15%)
4. Implementation Completeness (15%)

**Features:**
- Penalty calculation for incomplete tasks
- Progress tracking with trend analysis
- Multi-language test result parsing
- Targeted testing for faster feedback

## Data Flow

```
1. Goal Ingestion
   User Input → Requirement Parser → Parsed Requirements
                    ↓
2. Gap Analysis
   Parsed Requirements + Current Code → Gap Detection → Gap List
                    ↓
3. Roadmap Generation
   Gap List → Task Decomposition → Dependency Graph → Phased Roadmap
                    ↓
4. Task Execution Loop
   For each task:
   a. Context Assembly → Bounded Context
   b. Task Execution (external AI assistant)
   c. Result Submission → Verification
   d. Scoring → Progress Update
                    ↓
5. Completion
   All Tasks Complete + Score ≥ 85 → Project Complete
```

## MCP Interface

### Tools (11)

| Tool | Description |
|------|-------------|
| `orchestrator_ingest_goal` | Ingest a new project goal |
| `orchestrator_next_target` | Get the next task to execute |
| `orchestrator_submit_result` | Submit task execution results |
| `orchestrator_verify` | Verify current state |
| `orchestrator_status` | Get project status |
| `orchestrator_get_score` | Get detailed score breakdown |
| `orchestrator_list_tasks` | List all tasks |
| `orchestrator_force_retry` | Retry a failed task |
| `orchestrator_reset` | Reset orchestrator state |
| `orchestrator_create_checkpoint` | Create a named checkpoint |
| `orchestrator_restore_checkpoint` | Restore from checkpoint |

### Resources (6)

| Resource | URI | Description |
|----------|-----|-------------|
| State | `orchestrator://state` | Current orchestrator state |
| Current Task | `orchestrator://current-task` | Active task context |
| Score | `orchestrator://score` | Project score |
| Task List | `orchestrator://task-list` | All tasks |
| Errors | `orchestrator://errors` | Error log |
| Task History | `orchestrator://task-history` | Historical record |

### Prompts (4)

| Prompt | Description |
|--------|-------------|
| `orchestrator_next_target_guide` | Guide for requesting next task |
| `orchestrator_project_overview` | Project overview |
| `orchestrator_bounded_context` | Bounded context for current task |
| `orchestrator_error_context` | Error context for failed tasks |

## File Structure

```
src/
├── index.ts                    # CLI entry point
├── server.ts                   # MCP server setup
├── types/                      # Type definitions
│   ├── state.ts               # State, Task, BoundedContext
│   ├── task.ts                # File relevance, Roadmap
│   ├── gap.ts                 # Gap, Requirement
│   └── score.ts               # Score breakdown
├── core/                       # Core orchestration
│   ├── state-machine.ts       # State machine
│   ├── orchestrator.ts        # Main orchestrator
│   └── __tests__/             # Integration tests
├── mcp/                        # MCP interface
│   ├── tools.ts               # Tool handlers
│   ├── resources.ts           # Resource handlers
│   ├── prompts.ts             # Prompt handlers
│   └── index.ts               # Exports
├── subsystems/                 # Subsystem implementations
│   ├── state-manager/         # + __tests__/ (persistence, journal, recovery)
│   ├── gap-analyzer/          # + __tests__/ (semantic-analyzer)
│   ├── roadmap-generator/
│   ├── context-injector/      # + __tests__/ (targeted-testing, file-scorer)
│   ├── execution-sandbox/     # + __tests__/ (runner)
│   └── scoring-engine/
├── services/                   # Shared services
│   ├── llm-client.ts          # LLM integration
│   └── vector-store.ts        # LanceDB vector store
└── utils/                      # Utilities
    ├── config.ts              # Configuration
    ├── errors.ts              # Error types
    ├── logger.ts              # Structured logging with Winston
    ├── fs.ts                  # File system utilities
    └── hash.ts                # Hash computation
```

## Storage Schema

```
.orchestrator/
├── state/
│   ├── current.json           # Current orchestrator state
│   ├── journal/               # Write-ahead log entries
│   │   ├── 1704067200000.json
│   │   └── checkpoint-*.json
│   └── snapshots/             # Named checkpoints
│       ├── checkpoint-1.json
│       └── backup.json
├── tasks/
│   ├── completed/             # Completed task artifacts
│   └── failed/                # Failed task artifacts
├── errors/                    # Error log entries
├── projects/                  # Per-project isolation
│   └── {project-id}/
│       ├── goal.md           # Human-readable goal description
│       ├── gaps.json         # Gap analysis results
│       └── score-history.json # Score history tracking
├── orchestrator.log          # Structured application logs
└── error.log                 # Error-only logs
```

## Dependencies

### Required
- `@modelcontextprotocol/sdk` - MCP SDK
- `zod` - Schema validation
- `ts-morph` - TypeScript AST analysis
- `winston` - Logging

### Optional (for enhanced features)
- `@xenova/transformers` - HuggingFace embeddings
- `vectordb` - LanceDB vector store
- OpenAI/Anthropic API keys - LLM parsing

## Security Considerations

1. **Forbidden Files** - Tasks specify files that cannot be modified
2. **Governance Enforcement** - `GovernanceError` prevents unauthorized changes
3. **Sandboxed Execution** - Docker support for isolated verification
4. **State Encryption** - File permissions (0o600) on state files
5. **Checkpoint Isolation** - Checkpoints are isolated from runtime state

## Performance Optimizations

1. **Vector Search** - Semantic file relevance with LanceDB
2. **Lazy Indexing** - File index built on-demand, cached
3. **Targeted Testing** - Only run tests for affected files
4. **Journal Cleanup** - Automatic cleanup of old entries
5. **Topological Sorting** - Efficient task ordering

## Extension Points

1. **Custom Parsers** - Add new error parsers in execution-sandbox
2. **LLM Providers** - Extend llm-client.ts for new providers
3. **Scoring Heuristics** - Customize scoring in calculator.ts
4. **Context Templates** - Add new templates in templates.ts
