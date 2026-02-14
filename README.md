# Orchestrator MCP Server

An Autonomous Orchestration MCP Server that acts as a highly disciplined project manager for AI coding assistants.

## Features

- **State Machine-Driven Workflow**: Rigid orchestration through defined states
- **Gap Analysis**: Automatically detects what's missing vs. project goals
- **Task Decomposition**: Breaks down complex goals into atomic, verifiable tasks
- **Bounded Context Injection**: Isolates each task with focused context
- **Automated Verification**: Runs tests/builds to validate changes
- **Progress Scoring**: Tracks completion against 85+ quality threshold
- **Crash Recovery**: Persistent state with journaling and checkpoints

## Installation

```bash
npm install
npm run build
```

## Usage

### Start the Server

```bash
# Start in project directory
npx orchestrator-mcp-server

# Or specify project path
npx orchestrator-mcp-server --project /path/to/project

# With custom quality threshold
npx orchestrator-mcp-server --threshold 90
```

### MCP Tools

| Tool | Description |
|------|-------------|
| `orchestrator_ingest_goal` | Set a new project goal |
| `orchestrator_next_target` | Get the next atomic task |
| `orchestrator_submit_result` | Submit task results |
| `orchestrator_status` | Check project status |
| `orchestrator_get_score` | Get detailed score breakdown |
| `orchestrator_list_tasks` | List all tasks |
| `orchestrator_force_retry` | Retry a failed task |
| `orchestrator_reset` | Reset state (caution) |

### Workflow

1. **Ingest Goal**: Call `orchestrator_ingest_goal` with your project goal
2. **Get Target**: Call `orchestrator_next_target` to receive a bounded context
3. **Execute**: Implement the task within the specified boundaries
4. **Verify**: System automatically runs verification commands
5. **Submit**: Call `orchestrator_submit_result` with modified files
6. **Iterate**: Repeat until 85+ score achieved

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     MCP SERVER                               │
├─────────────────────────────────────────────────────────────┤
│  Tools  │  Resources  │  Prompts                            │
├─────────────────────────────────────────────────────────────┤
│                    ORCHESTRATOR CORE                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ State Mach. │  │ Task Queue  │  │ Score Engine        │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                    SUBSYSTEMS                                │
│  State Manager │ Context Injector │ Execution Sandbox       │
│  Gap Analyzer  │ Roadmap Generator │ Scoring Engine         │
├─────────────────────────────────────────────────────────────┤
│                    PERSISTENCE                               │
│  .orchestrator/state/  .orchestrator/tasks/                  │
└─────────────────────────────────────────────────────────────┘
```

## State Machine

```
IDLE → ANALYZE_GAPS → PLAN_ROADMAP → EXECUTE_SESSION → VERIFY_OUTPUT → SCORE_PROJECT
  ↑________________________________________________________↓                      
                                                                    (score < 85)
COMPLETE ←_________________________________________________________|
```

## License

MIT
