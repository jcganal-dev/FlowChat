
# FlowChat

> **A spatial, node-based LLM conversation canvas with tool-use, sandbox filesystem, and focus mode.**

FlowChat reimagines LLM interaction as a **spatial canvas** where conversations branch, fork, and reference each other visually. Built on FastAPI and vanilla JS, it combines infinite canvas with the power of tool-enabled LLMs.

---

## Key Features

### Spatial Conversation Canvas

- **Infinite 2D workspace** - pan, zoom, and arrange nodes freely
- **Node types** - Chat, Document, Image, Scrape
- **Branching & forking** - every node can spawn children, creating conversation trees
- **Visual connections** - SVG edges show parent→child relationships
- **Groups** - organize related nodes into collapsible groups with auto-summarization

### Simple Tool-Enabled LLM Loop

- **Native tool calling** - web search, scraping, file read/write/edit/delete
- **Sandbox filesystem** - isolated project directory with drag-drop upload
- **Multi-round tool execution** - configurable number of rounds per request
- **Streaming responses** - reasoning, content, and tool calls render in real-time
- **Reference chips** - `Shift` + `click` any node/group to inject context into prompts

### Focus Mode (Full-Screen Chat)

- **Linear chat view** - linear chat view for a more familiar and distraction-free interface
- **Sidebar** - with chat history & sandbox file browser
- **Real-time sync** - edits in focus mode propagate to canvas instantly

### Persistence & State

- **SQLite-backed save/load** - full canvas state (nodes, edges, groups, positions)
- **Auto-save** - automatically triggere on significant actions
- **Wipe/reset** - with simple `Alt` + `W`

### Developer Experience

- **Zero build step** - vanilla ES6 modules, runs in any modern browser
- **Modular architecture** - `BaseNode` → `ChatNode`/`FileNode`/`ScrapeNode`
- **Event-driven** - ResizeObserver, custom events, clean listener lifecycle
- **Responsive grid** - snapping, auto-layout, centered canvas

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│                          Browser                           │
│  ┌──────────────┐    ┌──────────────┐  ┌─────────────────┐ │
│  │  Canvas View │    │  Focus Mode  │  │ Sandbox Palette │ │
│  │  (nodes.js)  │    │  (nodes.js)  │  │  (sidebar.js)   │ │
│  └──────┬───────┘    └──────┬───────┘  └────────┬────────┘ │
│         │                   │                   │          │
│         └───────────────────┼───────────────────┘          │
│                             ▼                              │
│              ┌──────────────────────────────┐              │
│              │   Shared State (globals.js)  │              │
│              │  nodes[], groups{}, camera   │              │
│              └──────────────┬───────────────┘              │
└─────────────────────────────┼──────────────────────────────┘
                              │ HTTP / SSE
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
  ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
  │  /api/chat    │   │ /api/scrape   │   │ /api/sandbox/*│
  │  (SSE stream) │   │(Jina/Crawl4AI)│   │  (file CRUD)  │
  └───────┬───────┘   └───────┬───────┘   └───────┬───────┘
          │                   │                   │
          ▼                   ▼                   ▼
  ┌─────────────────────────────────────────────────────────┐
  │                    FastAPI (api.py)                     │
  │  • Tool registry (web_search, scrape, read/write/edit)  │
  │  • SQLite persistence (flowchat.db)                     │
  │  • OpenAI-compatible endpoint proxy                     │
  └─────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

- Python 3.10+
- Vanilla JS
- An OpenAI-compatible API endpoint (OpenRouter, OpenAI, local vLLM, etc.)

### Installation

```bash
# Clone & enter
git clone https://github.com/jcganal-dev/FlowChat
cd FlowChat

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Install Playwright browsers (for Crawl4AI scraping)
playwright install chromium
```

### Configuration

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

```ini
# .env
API_KEY = 'sk-or-v1-xxxxxxxxxxxxx'        # Your API key (OpenRouter recommended)
SERVER_URL = 'https://openrouter.ai/api/v1/chat/completions'
MODEL = 'anthropic/claude-3.5-sonnet'      # Or any model your endpoint supports
```

> **Note**: The app expects an OpenAI-compatible `/chat/completions` endpoint with `tools`, `stream`, and `include_reasoning` support.

### Run

```bash
# Development (auto-reload)
uvicorn api:app --reload --host 0.0.0.0 --port 5000

# Production
uvicorn api:app --host 0.0.0.0 --port 5000
```

Open **http://localhost:5000** in your browser.

---

## Usage Guide

### Canvas Navigation

| Action                  | Control                                           |
| ----------------------- | ------------------------------------------------- |
| Pan                     | `Middle-mouse` + drag                           |
| Zoom                    | `Scroll` / `Ctrl` + `Scroll`              |
| Center on active node   | `Alt` + `C`                                  |
| Auto-layout             | `Alt` + `L`                                   |
| Auto-layout + Rearrange | `Ctrl` + `Alt` + `L`                        |
| Toggle Focus Mode       | `Alt` + `F`                                   |
| Wipe Entire Canvas      | `Alt` + `W`                                   |
| Select Nodes            | `Shift` + `Click` <br />`Ctrl` + `Click` |
| Save State              | `Ctrl` + `S`                                  |
| Exit Focus Mode         | `Esc`                                           |

### Common Node Operations

| Action              | Control                                         |
| ------------------- | ----------------------------------------------- |
| Create node         | Right-click canvas → "Add Chat Node"           |
| Delete node         | Right-click node → "Delete Node"               |
| Group nodes         | Right-click node → "Group Selected Nodes"     |
| Create summary      | Right-click node → "Summarize Node"           |
| Branch/fork         | Click `+` handle on node bottom               |
| Drag node           | Drag header of node                             |
| Connect Nodes       | Drag handles on top or bottom of node           |
| Resize node         | Drag bottom-right handle.                       |
| Shift+Click node ID | Insert `reference_node` chip in focused input |
| Toggle summary      | Click expand/collapse icon (top right of node)  |

### Focus Mode

| Action            | Control                                                  |
| ----------------- | -------------------------------------------------------- |
| Enter focus       | Right-click node → "Enter Focus Mode"                   |
| Exit focus        | `Esc` key or "Exit Focus" button                       |
| Send message      | `Enter` (Shift+Enter for newline)                      |
| Stop generation   | Click stop button (appears during streaming)             |
| Switch chats      | Click entries in left sidebar (blocked during streaming) |
| Reference Sandbox | Drag files/folder into chatbox                           |

### Sandbox Files

- **Upload** - Use buttons beside sidebar header
- **Reference in chat** - Drag files/folder into chatbox → inserts `@filepath` chip
- **LLM tools:**
  * **web_search** - search the web for current information
  * **scrape** - fetch a webpage as markdown
  * **read_file** - read a file in the sandbox
  * **write_file** - write to a file in the sandbox (overwrites)
  * **list_sandbox_files** - list all files in the sandbox
  * **edit_file** - replace exact text in a file
  * **delete_file** - delete a file or folder
  * **create_folder** - create a new folder
  * **move_files** - move files/folders within the sandbox
  * **copy_files** - copy files/folders within the sandbox

---

## Project Structure

```
FlowChat/
├── api.py                 # FastAPI backend, tool registry, SSE chat endpoint
├── tools.py               # Tool implementations (search, scrape, file ops)
├── requirements.txt       # Python dependencies
├── .env.example           # Environment template
├── flowchat.db            # SQLite state (auto-created)
├── sandbox/               # Isolated filesystem for LLM tools
├── static/
│   ├── styles/index.css   # All styling (CSS custom properties)
│   ├── js/
│   │   ├── globals.js     # Shared state, utilities, renderMarkdown
│   │   ├── api.js         # Frontend API client (SSE parsing)
│   │   ├── canvas.js      # Canvas rendering, pan/zoom, edges, groups
│   │   ├── nodes.js       # Focus mode, lineage, node lifecycle
│   │   ├── chat.js        # Summarization (group & single node)
│   │   ├── sidebar.js     # Floating sandbox palette
│   │   ├── main.js        # Boot, event wiring, context menu
│   │   └── classes/
│   │       ├── BaseNode.js      # Drag, resize, header, cleanup
│   │       ├── ChatNode.js      # LLM execution, streaming UI
│   │       ├── FileNode.js      # Document/image display
│   │       └── ScrapeNode.js    # URL scraping, markdown render
├── templates/
│   └── index.html         # Main HTML shell, chat history UI
```

---

## Configuration Options

| Env Var             | Default  | Description                                              |
| ------------------- | -------- | -------------------------------------------------------- |
| `API_KEY`         | required | Your LLM provider API key                                |
| `SERVER_URL`      | required | OpenAI-compatible chat completions endpoint              |
| `MODEL`           | required | Model identifier (e.g., `anthropic/claude-3.5-sonnet`) |
| `MAX_TOOL_ROUNDS` | 200      | Max tool-call rounds per request (api.py)                |

---

## Roadmap / Known Limitations

- [ ] **More and Better Tools** - Because, of course.
- [ ] **Multi-user / collaboration** - WebSocket sync, presence
- [ ] **Export/import** - JSON, Markdown, conversation bundles
- [ ] **Keyboard shortcuts** - command palette, vim-mode canvas nav
- [ ] **Theme editor** - customize CSS variables in UI
- [ ] **Accessibility** - ARIA labels, focus management, screen reader support
- [ ] **Token counter UI** - re-enable thermometer (removed, see chat.js)
- [ ] **Plugin system** - custom node types, tool packs
- [ ] **Mobile/touch support** - canvas pan/zoom needs touch handling

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- **FastAPI** — modern, fast web framework
- **Crawl4AI** / **Jina Reader** — robust scraping
- **DDGS** — privacy-respecting search
- **marked** + **highlight.js** + **KaTeX** — markdown/math/code rendering
- **Prism.js** — syntax highlighting
- **OpenRouter** — unified LLM API access
- **IconScout** — UI icons:
  - JavaScript by **Icon Mafia**
  - Python by **Maninder Kaur**
  - HTML by **Venus** (Graphic Room)
  - CSS by **Pixel Icons**
- **SVG Repo** — responsive flat icons collection (chart, brush, pencil, bulb, folder, trash, clock, magnifying glass, error, upload, chevron, group, send, stop, cloud, globe, refresh, hourglass, node, document, image, focus, and app icon)

---

## 💡 Tips & Tricks

- **Reference chips persist** — `node-id` chips survive save/load and inject full context
- **ScrapeNode auto-branches** — successful scrapes auto-create a child chat node
- **Group summarize** — right-click group → "Summarize" compresses all nodes
- **Canvas state survives reload** — auto-saves to SQLite on every change
- **Shift+Click node ID** in canvas → inserts reference into *focused* input (focus mode or canvas)
