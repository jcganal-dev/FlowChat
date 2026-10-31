import json
import hashlib
import httpx
import sqlite3
import os
import shutil
from fastapi import FastAPI, Request, File, UploadFile, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
from typing import List, Any, Dict, Optional
from ddgs import DDGS
from dotenv import load_dotenv
import os
import asyncio
import stat
import sys
from pathlib import Path

import tools as agent_tools_module

agent_tools = agent_tools_module.Tools()

TOOL_REGISTRY, TOOLS_SCHEMA = agent_tools_module.build_tools(
    agent_tools,
    # exclude=["run_command"],   # remove this once you trust the agent's behavior
)

MAX_TOOL_ROUNDS = 200

async def execute_tool(name: str, args: dict) -> str:
    fn = TOOL_REGISTRY.get(name)
    if fn is None:
        return f"Error: unknown tool '{name}'"
    try:
        if asyncio.iscoroutinefunction(fn):
            result = await fn(**args)
        else:  # sync tools (e.g. DDGS) run in a thread so they don't block the loop
            result = await asyncio.to_thread(fn, **args)
        return result if isinstance(result, str) else json.dumps(result, ensure_ascii=False, default=str)
    except Exception as e:
        return f"Error running tool '{name}': {e}"

DB_PATH = "flowchat.db"
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS saved_states (
            id TEXT PRIMARY KEY,
            data TEXT
        )
    ''')
    conn.commit()
    conn.close()

init_db()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    # Same-origin only. The frontend is served from one of these, so nothing
    # breaks — but a random website can no longer call this API from a
    # browser and read responses (e.g. sandbox files, /api/settings).
    allow_origins=["http://localhost:5000", "http://127.0.0.1:5000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")
os.makedirs("sandbox", exist_ok=True)
app.mount("/sandbox", StaticFiles(directory="sandbox"), name="sandbox")
templates = Jinja2Templates(directory="templates")

@app.get("/api/sandbox/files")
async def get_sandbox_files():
    items = []
    files = []
    for root, dirnames, filenames in os.walk("sandbox"):
        rel_dir = os.path.relpath(root, "sandbox")
        if rel_dir == ".":
            rel_dir = ""
        for dirname in dirnames:
            dirpath = os.path.join(rel_dir, dirname).replace("\\", "/")
            items.append({"path": dirpath, "type": "directory"})
        for filename in filenames:
            filepath = os.path.join(rel_dir, filename).replace("\\", "/")
            items.append({"path": filepath, "type": "file"})
            files.append(filepath)
    return JSONResponse(content={"items": items, "files": files})

class FolderCreateRequest(BaseModel):
    name: str

@app.post("/api/sandbox/create_folder")
async def create_sandbox_folder(req: FolderCreateRequest):
    if ".." in req.name:
        raise HTTPException(status_code=400, detail="Invalid folder name")
    folder_path = os.path.join("sandbox", req.name)
    os.makedirs(folder_path, exist_ok=True)
    return JSONResponse(content={"message": "Folder created successfully"})

@app.post("/api/sandbox/upload")
async def upload_file(files: List[UploadFile] = File(...)):
    saved = []
    for file in files:
        if file.filename is None:
            raise HTTPException(status_code=400, detail="Uploaded file must have a filename")
        if ".." in file.filename:
            raise HTTPException(status_code=400, detail="Invalid filename")
        file_path = os.path.join("sandbox", file.filename)
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        saved.append(file.filename)
    return JSONResponse(content={"message": "Uploaded successfully", "files": saved})

def remove_readonly(func, path, _):
    """Clear the read-only bit and retry (Windows)."""
    os.chmod(path, stat.S_IWRITE)
    func(path)

@app.delete("/api/sandbox/delete/{filename:path}")
async def delete_sandbox_file(filename: str):
    file_path = os.path.join("sandbox", filename)
    if not os.path.exists(file_path):
        return JSONResponse(content={"message": "File/Folder already deleted"})
    try:
        if os.path.isdir(file_path):
            # Handle long paths on Windows (.git has deeply nested dirs)
            target = os.path.abspath(file_path)
            if sys.platform == "win32":
                target = "\\\\?\\" + target
            shutil.rmtree(target, onerror=remove_readonly)
        else:
            os.remove(file_path)
        return JSONResponse(content={"message": "File/Folder deleted successfully"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class MoveSandboxFilesRequest(BaseModel):
    paths: List[str]
    target: str

@app.post("/api/sandbox/move")
async def move_sandbox_files(req: MoveSandboxFilesRequest):
    target_dir = os.path.join("sandbox", req.target)
    if not os.path.exists(target_dir):
        os.makedirs(target_dir, exist_ok=True)
    elif not os.path.isdir(target_dir):
        raise HTTPException(status_code=400, detail="Target is not a directory")

    try:
        for path in req.paths:
            src_path = os.path.join("sandbox", path)
            if not os.path.exists(src_path):
                continue
            filename = os.path.basename(src_path)
            dst_path = os.path.join(target_dir, filename)
            shutil.move(src_path, dst_path)
        return JSONResponse(content={"message": "Moved successfully"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/", response_class=HTMLResponse)
async def serve_canvas(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"request": request},
    )

class SaveSandboxFileRequest(BaseModel):
    filename: str
    content: str

def sandbox_fingerprint() -> str:
    """Cheap snapshot of the sandbox tree (paths + sizes + mtimes), hashed.
    Used by /api/sandbox/events to detect changes from any source."""
    parts = []
    for root, dirnames, filenames in os.walk("sandbox"):
        rel_dir = os.path.relpath(root, "sandbox")
        if rel_dir == ".":
            rel_dir = ""
        for dirname in dirnames:
            dirpath = os.path.join(rel_dir, dirname).replace("\\", "/")
            try:
                st = os.stat(os.path.join(root, dirname))
                parts.append(f"d:{dirpath}:{st.st_mtime_ns}")
            except OSError:
                parts.append(f"d:{dirpath}")
        for filename in filenames:
            filepath = os.path.join(rel_dir, filename).replace("\\", "/")
            try:
                st = os.stat(os.path.join(root, filename))
                parts.append(f"f:{filepath}:{st.st_size}:{st.st_mtime_ns}")
            except OSError:
                parts.append(f"f:{filepath}")
    parts.sort()
    return hashlib.md5("\n".join(parts).encode("utf-8", "replace")).hexdigest()

@app.get("/api/sandbox/events")
async def sandbox_events(request: Request):
    """SSE stream that notifies clients whenever the sandbox tree changes,
    whether the change came from the app or from a manual edit on disk."""
    async def event_stream():
        last = None
        while True:
            if await request.is_disconnected():
                return
            current = await asyncio.to_thread(sandbox_fingerprint)
            if last is not None and current != last:
                yield "event: sandbox-changed\ndata: {}\n\n"
            last = current
            # Comment line: keeps the connection warm and flushes the headers
            yield ": ping\n\n"
            await asyncio.sleep(1.0)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )

@app.post("/api/sandbox/save")
async def save_sandbox_file(req: SaveSandboxFileRequest):
    try:
        os.makedirs("sandbox", exist_ok=True)
        filename = os.path.basename(req.filename)
        if not filename.endswith(".md"):
            filename += ".md"
        file_path = os.path.join("sandbox", filename)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(req.content)
        return JSONResponse(content={"message": "Saved successfully"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ScrapeRequest(BaseModel):
    url: str

@app.post("/api/scrape")
async def scrapeTool(url: ScrapeRequest):
    result = await agent_tools.scrape(url.url)
    return JSONResponse(content={"content": result})

@app.get("/api/models")
async def get_models():
    """Fetch free models from OpenRouter."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get("https://openrouter.ai/api/v1/models")
            if response.status_code != 200:
                return JSONResponse(content={"models": [], "error": "Failed to fetch models"}, status_code=500)

            data = response.json()
            models_by_id = {m.get("id"): m for m in data.get("data", []) if m.get("id")}

            def entry(model):
                return {
                    "id": model.get("id"),
                    "name": model.get("name"),
                    "context_length": model.get("context_length")
                }

            models = []
            # The .env MODEL is always selectable and listed first, even if it isn't free
            if MODEL and MODEL in models_by_id:
                models.append(entry(models_by_id[MODEL]))

            # Then the free models (both prompt and completion costs are zero)
            for model in data.get("data", []):
                modelId = model.get("id", '')
                pricing = model.get("pricing", {})
                prompt_cost = pricing.get("prompt", "0")
                completion_cost = pricing.get("completion", "0")
                try:
                    if float(prompt_cost) == 0 and float(completion_cost) == 0 and (modelId.split(':')[-1] == 'free' or modelId == 'openrouter/free') and modelId != MODEL:
                        models.append(entry(model))
                except (ValueError, TypeError):
                    continue

            return JSONResponse(content={"models": models, "default_model": MODEL})
    except Exception as e:
        return JSONResponse(content={"models": [], "error": str(e)}, status_code=500)

env_path = Path(".env")

if not env_path.exists():
    api_key = input("Enter API_KEY: ").strip()
    model = input("Enter MODEL (optional, press Enter to use default): ").strip()
    env_content = f"API_KEY={api_key}\n"
    if model:
        env_content += f"MODEL={model}\n"
    env_path.write_text(env_content)

load_dotenv(dotenv_path=env_path)

API_KEY = os.getenv("API_KEY")
MODEL = os.getenv("MODEL", "openrouter/free")  # Default to OpenRouter's free-model router

if not API_KEY:
    raise ValueError("API_KEY not found in .env file")

def mask_secret(secret: str) -> str:
    """Render a secret safe to display: enough to recognize it, not enough to use it."""
    if not secret:
        return ""
    if len(secret) <= 12:
        return "*" * len(secret)
    return f"{secret[:8]}...{secret[-4:]}"

def _clean_env_value(value: str, label: str) -> str:
    """Validate a value destined for .env — reject anything that could break the file format."""
    value = value.strip()
    if not value:
        raise HTTPException(status_code=400, detail=f"{label} cannot be empty")
    if any(c in value for c in "\n\r\"'"):
        raise HTTPException(status_code=400, detail=f"{label} contains invalid characters (quotes/newlines)")
    return value

def update_env_file(updates: Dict[str, str]) -> None:
    """Persist key=value pairs into .env, preserving every other line (comments included).
    Writes atomically so a crash mid-write can't corrupt the file."""
    lines = []
    seen = set()
    if env_path.exists():
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                stripped = line.strip()
                if stripped and not stripped.startswith("#") and "=" in stripped:
                    key = stripped.split("=", 1)[0].strip()
                    if key in updates:
                        lines.append(f"{key}={updates[key]}\n")
                        seen.add(key)
                        continue
                lines.append(line)
    for key, value in updates.items():
        if key not in seen:
            lines.append(f"{key}={value}\n")
    tmp_path = env_path.with_name(env_path.name + ".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.writelines(lines)
    os.replace(tmp_path, env_path)

class SettingsPayload(BaseModel):
    api_key: Optional[str] = None
    model: Optional[str] = None

@app.get("/api/settings")
async def get_settings():
    """Current backend settings. The API key is returned masked — the full
    value never leaves the server."""
    return JSONResponse(content={
        "api_key_set": bool(API_KEY),
        "api_key_masked": mask_secret(API_KEY or ""),
        "model": MODEL,
    })

@app.post("/api/settings")
async def update_settings(payload: SettingsPayload):
    """Update API key and/or default model at runtime — no restart needed.
    Only the fields provided (and non-empty) are changed."""
    global API_KEY, MODEL
    updates = {}

    if payload.api_key is not None and payload.api_key.strip():
        key = _clean_env_value(payload.api_key, "API key")
        if not key.startswith("sk-or-"):
            raise HTTPException(status_code=400, detail="API key must start with 'sk-or-' (OpenRouter key)")
        updates["API_KEY"] = key
        API_KEY = key

    if payload.model is not None and payload.model.strip():
        model = _clean_env_value(payload.model, "Model")
        updates["MODEL"] = model
        MODEL = model

    if not updates:
        return JSONResponse(content={
            "message": "Nothing to update",
            "api_key_set": bool(API_KEY),
            "api_key_masked": mask_secret(API_KEY or ""),
            "model": MODEL,
        })

    await asyncio.to_thread(update_env_file, updates)
    return JSONResponse(content={
        "message": "Settings saved",
        "api_key_set": bool(API_KEY),
        "api_key_masked": mask_secret(API_KEY or ""),
        "model": MODEL,
    })

tool_list = []

for key in TOOL_REGISTRY:
    tool_list.append(key)

from datetime import date

SYSTEM_INSTRUCTIONS = [
    f"You have access to tools ({', '.join(tool_list)}).",
    "Use web_search whenever the question involves current events, recent data, or facts you're unsure about.",
    "Prefer one focused search over many broad ones. Summarize results in your answer instead of dumping raw tool output.",
    "If a search fails, tell the user rather than retrying indefinitely.",
    "Once you arrive at an answer, give the answer to the user. Do not overthink.",
    "You are already inside the sandbox directory. If you want to access a file, ommit 'sandbox/' from your path (just use file.txt instead of sandbox/file.txt",
    "Make sure to tell the user what you did after finishing your task.",
    "Strictly work ONLY inside sandbox, do not modify any global instances (e.g. if using python create a venv etc.)"
]

BASE_SYSTEM_PROMPT = "\n".join(SYSTEM_INSTRUCTIONS)

class ChatPayload(BaseModel):
    messages: List[Any]
    max_tokens: int = 500
    model: Optional[str] = None

@app.post("/api/chat")
async def chat_endpoint(user_data: ChatPayload):
    messages = user_data.messages
    # Use model from payload if provided, otherwise fall back to env MODEL
    model = user_data.model or MODEL

    if len(messages) > 0 and messages[0].get("role") == "system":
        messages[0]["content"] = f"{BASE_SYSTEM_PROMPT}\n\n{messages[0].get('content', '')}"
    else:
        messages.insert(0, {"role": "system", "content": BASE_SYSTEM_PROMPT})

    async def stream_generator():
        async with httpx.AsyncClient(timeout=None) as client:
            headers = {
                "Authorization": f"Bearer {API_KEY}",
                "Content-Type": "application/json",
            }

            for _round in range(MAX_TOOL_ROUNDS):
                payload = {
                    "model": model,
                    "messages": messages,
                    "tools": TOOLS_SCHEMA,
                    "include_reasoning": True,
                    "stream": True,
                }

                assistant_content = ""
                streamed_calls: Dict[int, dict] = {}  # index -> accumulated call
                had_error = False

                async with client.stream("POST", "https://openrouter.ai/api/v1/chat/completions", json=payload, headers=headers) as response:
                    if response.status_code != 200:
                        error_body = await response.aread()
                        try:
                            err_msg = json.loads(error_body.decode()).get("error", {}).get("message", "Unknown API Error")
                        except Exception:
                            err_msg = error_body.decode()
                        yield json.dumps({"content": f"\n\n[API ERROR: HTTP {response.status_code} - {err_msg}]"}) + "\n"
                        return

                    async for line in response.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        data_str = line[6:]
                        if data_str == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue

                        if "error" in chunk:
                            yield json.dumps({"content": f"\n\n[API ERROR: {chunk['error'].get('message', 'Unknown error')}]"}) + "\n"
                            had_error = True
                            break

                        if not chunk.get("choices"):
                            continue
                        delta = chunk["choices"][0].get("delta", {})

                        # print(delta)
                        if "reasoning" in delta:
                            yield json.dumps({"reasoning_content": delta["reasoning"]}) + "\n"
                            
                        if "reasoning_content" in delta:
                            yield json.dumps({"reasoning_content": delta["reasoning_content"]}) + "\n"

                        if delta.get("content"):
                            assistant_content += delta["content"]
                            # print(delta["content"])
                            yield json.dumps({"content": delta["content"]}) + "\n"

                        # tool call arguments arrive in pieces — merge by index
                        if delta.get("tool_calls"):
                            for tc in delta["tool_calls"]:
                                idx = tc.get("index", 0)
                                entry = streamed_calls.setdefault(idx, {"id": None, "name": "", "arguments": "", "announced": False})
                                if tc.get("id"):
                                    entry["id"] = tc["id"]
                                fn = tc.get("function") or {}
                                if fn.get("name"):
                                    entry["name"] = fn["name"]

                                # Announce ONCE, the moment we know the name
                                if entry["name"] and not entry["announced"]:
                                    entry["announced"] = True
                                    call_id = entry["id"] or f"call_{idx}"
                                    yield json.dumps({
                                        "tool_call_start": {
                                            "id": call_id,
                                            "name": entry["name"],
                                        }
                                    }) + "\n"

                                if fn.get("arguments"):
                                    entry["arguments"] += fn["arguments"]

                if had_error or not streamed_calls:
                    return

                # Build the assistant message with tool_calls and execute them
                calls = [streamed_calls[i] for i in sorted(streamed_calls)]
                messages.append({
                    "role": "assistant",
                    "content": assistant_content or None,
                    "tool_calls": [
                        {
                            "id": c["id"] or f"call_{i}",
                            "type": "function",
                            "function": {"name": c["name"], "arguments": c["arguments"] or "{}"},
                        }
                        for i, c in enumerate(calls)
                    ],
                })

                for i, c in enumerate(calls):
                    call_id = c["id"] or f"call_{i}"
                    yield json.dumps({"tool_call": {"id": call_id, "name": c["name"], "arguments": c["arguments"]}}) + "\n"
                    try:
                        args = json.loads(c["arguments"] or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    result = await execute_tool(c["name"], args)
                    yield json.dumps({"tool_result": {"id": call_id, "name": c["name"], "result": result}}) + "\n"
                    messages.append({
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": result[:8000],
                    })

            yield json.dumps({"content": "\n\n[Stopped: max tool rounds reached]"}) + "\n"

    return StreamingResponse(stream_generator(), media_type="text/event-stream")

class SavePayload(BaseModel):
    state: Dict[str, Any]

@app.post("/api/save")
async def save_state(payload: SavePayload):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "INSERT OR REPLACE INTO saved_states (id, data) VALUES (?, ?)", 
        ("default_save", json.dumps(payload.state))
    )
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.get("/api/load")
async def load_state():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT data FROM saved_states WHERE id = ?", ("default_save",))
    row = c.fetchone()
    conn.close()
    
    if row:
        return {"status": "success", "state": json.loads(row[0])}
    return {"status": "empty"}
