<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d1117,50:161b22,100:0d1117&height=200&section=header&text=Orchestrator%20MCP&fontSize=60&fontColor=58a6ff&animation=fadeIn&fontAlignY=35&desc=Autonomous%20Orchestration%20Server%20for%20AI%20Coding%20Assistants&descAlignY=55&descSize=18"/>

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Protocol-1C3C3C?style=for-the-badge)](https://modelcontextprotocol.io)
[![Vitest](https://img.shields.io/badge/Vitest-Testing-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev)
[![License](https://img.shields.io/badge/License-MIT-2ea44f?style=for-the-badge)](LICENSE)

[Features](#-features) · [Quick Start](#-quick-start) · [Architecture](#-architecture) · [MCP Tools](#-mcp-tools)

</div>

---

## 🎯 What is Orchestrator MCP?

**Orchestrator MCP** is an autonomous orchestration server implementing the [Model Context Protocol (MCP)](https://modelcontextprotocol.io). It acts as a **highly disciplined project manager** for AI coding assistants — breaking down complex goals into atomic tasks, tracking progress, and enforcing quality gates.

Think of it as an AI project manager that:
- 📋 **Decomposes** complex goals into verifiable atomic tasks
- 🔍 **Analyzes gaps** between current state and project goals
- 📊 **Scores progress** against an 85+ quality threshold
- 🔄 **Recovers from crashes** with persistent state and journaling
- 🧠 **Injects bounded context** to keep each task focused

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **State Machine-Driven** | Rigid orchestration through defined states (IDLE → ANALYZE → PLAN → EXECUTE → VERIFY → SCORE) |
| **Gap Analysis** | Auto-detects what's missing vs. project goals |
| **Task Decomposition** | Breaks complex goals into atomic, verifiable tasks |
| **Bounded Context** | Isolates each task with focused context injection |
| **Auto Verification** | Runs tests/builds to validate changes |
| **Progress Scoring** | Tracks completion against 85+ quality threshold |
| **Crash Recovery** | Persistent state with journaling and checkpoints |

---

## 🚀 Quick Start

### Installation

```bash
npm install
npm run build
```

### Start the Server

```bash
# Start in project directory
npx orchestrator-mcp-server

# Or specify project path
npx orchestrator-mcp-server --project /path/to/project

# With custom quality threshold
npx orchestrator-mcp-server --threshold 90
```

---

## 🔧 MCP Tools

| Tool | Description |
|------|-------------|
| `orchestrator_ingest_goal` | Set a new project goal |
| `orchestrator_next_target` | Get the next atomic task with bounded context |
| `orchestrator_submit_result` | Submit task results for verification |
| `orchestrator_status` | Check current project status |
| `orchestrator_get_score` | Get detailed score breakdown |
| `orchestrator_list_tasks` | List all tasks in the queue |
| `orchestrator_force_retry` | Retry a failed task |
| `orchestrator_reset` | Reset state (**caution**: clears all progress) |

### Workflow

```
1. orchestrator_ingest_goal    → Define your project objective
2. orchestrator_next_target    → Receive atomic task + context
3. Execute task within bounds
4. orchestrator_submit_result  → Submit + auto-verify
5. Repeat until score ≥ 85
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     MCP SERVER                               │
├─────────────────────────────────────────────────────────────┤
│  Tools  │  Resources  │  Prompts                            │
├─────────────────────────────────────────────────────────────┤
│                    ORCHESTRATOR CORE                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ State Mach. │  │ Task Queue  │  │   Score Engine      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                    SUBSYSTEMS                                │
│  State Manager │ Context Injector │ Execution Sandbox       │
│  Gap Analyzer  │ Roadmap Generator│ Scoring Engine          │
├─────────────────────────────────────────────────────────────┤
│                    PERSISTENCE                               │
│         .orchestrator/state/   .orchestrator/tasks/         │
└─────────────────────────────────────────────────────────────┘
```

### State Machine

```
IDLE → ANALYZE_GAPS → PLAN_ROADMAP → EXECUTE_SESSION → VERIFY_OUTPUT → SCORE_PROJECT
 ↑________________________________________________________________________↓
                           (score < 85)
COMPLETE ←_______________________________________________________________|
```

**Key threshold:** Projects scoring **< 85** loop back for revision; **≥ 85** completes.

---

## 📁 Project Structure

```
code-analyzer-mcp/
├── src/                    # TypeScript source
├── schemas/                # Data schemas
├── tests/                  # Vitest test suite
├── docs/                   # Documentation
├── bin/                    # Executable scripts
├── package.json            # Node.js dependencies
├── tsconfig.json           # TypeScript config
└── vitest.config.ts        # Test configuration
```

---

## 🧪 Testing

```bash
npm test        # Run Vitest suite
npm run check   # Lint + type-check
```

---

## 📜 License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">

**Built with** 📘 **TypeScript** · 🔧 **MCP Protocol** · 🧪 **Vitest**

</div>
