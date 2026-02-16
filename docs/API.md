# Orchestrator MCP Server - API Reference

## Tools

### orchestrator_ingest_goal

Ingest a new project goal and initialize the orchestration loop.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "goal": {
      "type": "string",
      "description": "Master project goal description"
    },
    "constraints": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Additional constraints"
    },
    "structuredRequirements": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "description": { "type": "string" },
          "type": { "enum": ["feature", "bugfix", "refactor", "test"] },
          "priority": { "enum": ["critical", "high", "medium", "low"] },
          "components": { "type": "array", "items": { "type": "string" } },
          "acceptanceCriteria": { "type": "array", "items": { "type": "string" } },
          "dependencies": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["description", "type", "priority"]
      }
    }
  },
  "required": ["goal"]
}
```

**Example:**
```json
{
  "goal": "Implement a user authentication system with JWT tokens",
  "constraints": ["Use TypeScript", "No external auth libraries"]
}
```

### orchestrator_next_target

Get the next atomic task to execute in an isolated session.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Unique session identifier"
    }
  },
  "required": ["sessionId"]
}
```

**Returns:** Bounded context with task details, relevant files, and instructions.

### orchestrator_submit_result

Submit the result of executing a task.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "taskId": {
      "type": "string",
      "description": "ID of the completed task"
    },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": { "type": "string" },
          "content": { "type": "string" }
        },
        "required": ["path", "content"]
      }
    },
    "notes": {
      "type": "string",
      "description": "Additional notes"
    }
  },
  "required": ["taskId", "files"]
}
```

### orchestrator_verify

Run verification on the current project without submitting a task result. Runs language-appropriate verification commands (tsc --noEmit, npm test, eslint for TypeScript; cargo check, cargo test, cargo clippy for Rust; etc.).

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "verbose": {
      "type": "boolean",
      "description": "Include detailed output from all verification commands"
    }
  }
}
```

**Returns:**
```
✓ Project verification passed!

✓ npx tsc --noEmit
✓ npm test
✓ npx eslint .
```

Or on failure:
```
✗ Project verification failed.

✓ npx tsc --noEmit
✗ npm test
  Test suite failed: 2 tests failed
✓ npx eslint .
```

### orchestrator_status

Get current project status and score.

**Returns:**
```
📊 Project Status
────────────────
State: EXECUTE_SESSION
Score: 72/100

Tasks:
  • Pending: 5
  • Completed: 12
  • Failed: 1

Current Task: Implement JWT token generation
```

### orchestrator_get_score

Get detailed project score breakdown.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "includeHistory": {
      "type": "boolean",
      "description": "Include score history"
    }
  }
}
```

**Returns:**
```
🎯 Project Score: 72/100
──────────────────────

Breakdown:
  Requirements Coverage: 85.0%
  Test Pass Rate: 90.0%
  Code Quality: 75.0%
  Implementation: 65.0%
```

### orchestrator_list_tasks

List all tasks in the current roadmap.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "filter": {
      "type": "string",
      "enum": ["pending", "completed", "failed", "all"],
      "description": "Filter tasks by status"
    }
  }
}
```

**Returns:**
```
📋 Tasks (pending)
──────────────────────

○ [1] Setup JWT library
   Install and configure jsonwebtoken package...

○ [1] Create auth middleware
   Implement Express middleware for JWT verification...

▶ [2] Implement login endpoint
   Create POST /auth/login endpoint...
```

### orchestrator_force_retry

Force retry of a failed task with error context.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "taskId": {
      "type": "string",
      "description": "ID of the failed task to retry"
    },
    "error": {
      "type": "string",
      "description": "Error message to include in context"
    }
  },
  "required": ["taskId"]
}
```

### orchestrator_reset

Reset orchestrator state (use with caution).

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "confirm": {
      "type": "boolean",
      "description": "Must be true to confirm reset"
    }
  },
  "required": ["confirm"]
}
```

### orchestrator_create_checkpoint

Create a named checkpoint for rollback.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Checkpoint name"
    }
  }
}
```

**Returns:** Checkpoint ID (e.g., `checkpoint-1704067200000` or the provided name)

### orchestrator_restore_checkpoint

Restore state from a checkpoint.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "checkpointId": {
      "type": "string",
      "description": "Checkpoint ID to restore"
    }
  },
  "required": ["checkpointId"]
}
```

---

## Resources

### orchestrator://state

Current orchestrator state including goal, progress, and task queue.

**MIME Type:** `application/json`

**Example:**
```json
{
  "status": {
    "state": "EXECUTE_SESSION",
    "score": 72,
    "pendingTasks": 5,
    "completedTasks": 12,
    "failedTasks": 1,
    "currentTask": { ... }
  },
  "tasks": [
    { "id": "task-1", "phase": 1, "title": "Setup JWT", "status": "completed" }
  ]
}
```

### orchestrator://current-task

Full context for the currently active task.

**MIME Type:** `application/json`

**Example:**
```json
{
  "id": "task-13",
  "phase": 2,
  "title": "Implement login endpoint",
  "description": "Create POST /auth/login endpoint...",
  "status": "in_progress",
  "attempts": 0,
  "context": {
    "relevantFiles": ["src/auth/controller.ts", "src/auth/service.ts"],
    "forbiddenFiles": ["node_modules/**", ".env"],
    "instructions": "..."
  }
}
```

### orchestrator://score

Current project score and breakdown.

**MIME Type:** `application/json`

**Example:**
```json
{
  "score": 72,
  "breakdown": {
    "requirementsCoverage": 85.0,
    "testPassRate": 90.0,
    "codeQuality": 75.0,
    "implementationCompleteness": 65.0,
    "penalties": 0
  }
}
```

### orchestrator://task-list

All tasks in the current roadmap.

**MIME Type:** `application/json`

**Example:**
```json
{
  "total": 18,
  "tasks": [
    { "id": "task-1", "phase": 1, "title": "Setup JWT", "status": "completed", "attempts": 1 },
    { "id": "task-2", "phase": 1, "title": "Create middleware", "status": "completed", "attempts": 2 }
  ]
}
```

### orchestrator://errors

Error history and patterns from failed tasks.

**MIME Type:** `application/json`

### orchestrator://task-history

Historical record of all task executions with timing and results.

**MIME Type:** `application/json`

**Example:**
```json
{
  "summary": {
    "total": 18,
    "completed": 12,
    "failed": 1
  },
  "completedTasks": [
    { "id": "task-1", "title": "Setup JWT", "phase": 1, "completedAt": "2024-01-01T12:00:00Z" }
  ],
  "failedTasks": [
    { "id": "task-5", "title": "Database schema", "phase": 2, "attempts": 3 }
  ]
}
```

### orchestrator://task/{taskId}

Details for a specific task by ID (resource template).

**MIME Type:** `application/json`

---

## Prompts

### orchestrator_next_target_guide

Guide the user on how to request and work on the next target.

**Usage:** Provides guidance on the orchestration workflow.

**Example Output:**
```
# Next Target Guide

## Current State: EXECUTE_SESSION

There are 5 pending tasks waiting to be executed.

## How to Get the Next Target

Call `orchestrator_next_target` with your session ID.

## Working on a Task

1. Review the bounded context provided
2. Note the essential files and forbidden files
3. Implement only within the specified boundaries
4. Run the verification commands before submitting
5. Submit results with `orchestrator_submit_result`
```

### orchestrator_project_overview

Get an overview of the current project state.

**Example Output:**
```markdown
# Project Overview

## Status
- Current State: EXECUTE_SESSION
- Completion Score: 72/100
- Quality Threshold: 85

## Tasks
- Pending: 5
- Completed: 12
- Failed: 1

## Current Task
- Title: Implement login endpoint
- Phase: 2
- Attempts: 0

## Next Steps
1. Call 'orchestrator_next_target' to get the next task
2. Review the bounded context provided
3. Implement the task within the specified boundaries
4. Submit results with 'orchestrator_submit_result'
```

### orchestrator_bounded_context

Get the bounded context for the current task including allowed and forbidden files.

**Example Output:**
```markdown
# Bounded Context for Task: Implement login endpoint

## Task Description
Create POST /auth/login endpoint that validates credentials...

## Phase: 2

## Essential Files (4)
- src/auth/controller.ts (relevance: 95%)
- src/auth/service.ts (relevance: 90%)
- src/types/auth.ts (relevance: 85%)
- src/middleware/auth.ts (relevance: 80%)

## Reference Files (2)
- src/config/jwt.ts (relevance: 70%)
- src/utils/crypto.ts (relevance: 65%)

## ⚠️ Forbidden Files (DO NOT MODIFY)
- node_modules/**
- .env
- src/auth/legacy.ts

## Verification Commands
- `npm run test:auth`
- `npm run lint`
```

### orchestrator_error_context

Get error context and guidance for failed tasks.

**Arguments:**
- `taskId` (optional) - ID of the failed task to get error context for

**Example Output (without taskId):**
```markdown
# Error Context

There are 1 failed task(s).

## How to Retry
1. List failed tasks: `orchestrator_list_tasks(filter: "failed")`
2. Get error context with a specific taskId
3. Fix the issues and use `orchestrator_force_retry` to retry
```

**Example Output (with taskId):**
```markdown
# Error Context

## Failed Task: Database schema
- Task ID: task-5
- Attempts: 3
- Phase: 2

## Recommendations
1. Review the task description and acceptance criteria
2. Check the bounded context for relevant files
3. Run verification commands to understand the failure
4. Use 'orchestrator_force_retry' with error details to retry
```

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENAI_API_KEY` | OpenAI API key for LLM parsing | Optional |
| `ANTHROPIC_API_KEY` | Anthropic API key for LLM parsing | Optional |
| `LLM_API_KEY` | Custom LLM API key | Optional |
| `LLM_BASE_URL` | Custom LLM base URL | Optional |
| `LLM_MODEL` | Custom LLM model name | Optional |

---

## State Machine States

| State | Description |
|-------|-------------|
| `IDLE` | Waiting for goal ingestion |
| `ANALYZE_GAPS` | Analyzing gaps between goal and current state |
| `PLAN_ROADMAP` | Generating execution roadmap |
| `EXECUTE_SESSION` | Executing tasks |
| `VERIFY_OUTPUT` | Verifying task output |
| `SCORE_PROJECT` | Calculating project score |
| `COMPLETE` | Project complete (score ≥ 85) |

---

## Error Handling

The orchestrator uses structured error types:

| Error Type | Description |
|------------|-------------|
| `syntax` | Syntax errors in code |
| `type` | Type errors (TypeScript, etc.) |
| `runtime` | Runtime errors |
| `test` | Test failures |
| `lint` | Linting errors |
| `timeout` | Execution timeouts |
| `crash` | Process crashes |
| `dependency` | Dependency resolution failures |

## Retry Policy

| Error Type | Max Retries |
|------------|-------------|
| `syntax` | 5 |
| `test` | 3 |
| `timeout` | 2 |
| `crash` | 3 |
| `dependency` | 1 |
