import json
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
from typing import List, Any, Dict
from ddgs import DDGS
from dotenv import load_dotenv
import os
from tools import Tools
import asyncio
import stat
import sys
from pathlib import Path

agent_tools = Tools()

TOOL_REGISTRY = {
    "web_search": agent_tools.web_search,
    "scrape": agent_tools.scrape,
    "read_file": agent_tools.read_file,
    "write_file": agent_tools.write_file,
    "list_sandbox_files": agent_tools.list_sandbox_files,
    "edit_file": agent_tools.edit_file,
    "delete_file": agent_tools.delete_file,
    "create_folder": agent_tools.create_folder,
    "move_files": agent_tools.move_files,
    "copy_files": agent_tools.copy_files,
}

TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for current information. Use for anything recent, factual, or uncertain.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query"},
                    "max_results": {"type": "integer", "description": "Number of results to fetch (default 3)"}
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "scrape",
            "description": "Fetch the full content of a specific webpage as markdown. Only allows valid url. Does not allow file:/// format.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL to fetch"}
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the contents of a file in the sandbox directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "The path to the file you want to read."},
                    "offset": {"type": "integer", "description": "The offset to which you start reading the file's content"},
                    "length": {"type": "integer", "description": "The lenght of content you want to read."},
                },
                "required": ["file_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write the contents of a file in the sandbox directory. Warning: this will overwrite the whole content of the target file",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "The path to the file you want to write to."},
                    "content": {"type": "string", "description": "The content you want to write into the file."}
                },
                "required": ["file_path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_sandbox_files",
            "description": "Get the list of all files in the sandbox",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "edit_file",
            "description": "Edit a file in the sandbox by replacing exact string matches. Not a regex — provide the literal text to find and replace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "The path to the file you want to edit."},
                    "old_string": {"type": "string", "description": "The exact text to find and replace."},
                    "new_string": {"type": "string", "description": "The text to replace it with."}
                },
                "required": ["file_path", "old_string", "new_string"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_file",
            "description": "Delete a file or folder from the sandbox directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "The path to the file or folder to delete."}
                },
                "required": ["file_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_folder",
            "description": "Create a folder in the sandbox directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "folder_path": {"type": "string", "description": "The path of the folder to create."}
                },
                "required": ["folder_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "move_files",
            "description": "Move one or more files or folders to a target directory within the sandbox.",
            "parameters": {
                "type": "object",
                "properties": {
                    "paths": {"type": "array", "items": {"type": "string"}, "description": "List of source paths to move."},
                    "target": {"type": "string", "description": "The target directory path."}
                },
                "required": ["paths", "target"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "copy_files",
            "description": "Copy one or more files or folders to a target directory within the sandbox.",
            "parameters": {
                "type": "object",
                "properties": {
                    "paths": {"type": "array", "items": {"type": "string"}, "description": "List of source paths to copy."},
                    "target": {"type": "string", "description": "The target directory path."}
                },
                "required": ["paths", "target"],
            },
        },
    },
]

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
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
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

env_path = Path(".env")

if not env_path.exists():
    api_key = input("Enter API_KEY: ").strip()
    server_url = input("Enter SERVER_URL: ").strip()
    model = input("Enter MODEL: ").strip()
    env_path.write_text(f"API_KEY={api_key}\nSERVER_URL={server_url}\nMODEL={model}\n")

load_dotenv(dotenv_path=env_path)

API_KEY = os.getenv("API_KEY")
SERVER_URL: str = os.getenv("SERVER_URL", "")
MODEL = os.getenv("MODEL")

if not API_KEY:
    raise ValueError("API_KEY not found in .env file")
if not SERVER_URL:
    raise ValueError("SERVER_URL not found in .env file")
if not MODEL:
    raise ValueError("MODEL not found in .env file")

tool_list = []

for key in TOOL_REGISTRY:
    tool_list.append(key)

from datetime import date

SYSTEM_INSTRUCTIONS = [
    f"You have access to tools ({', '.join(tool_list)}).",
    f"For you reference, today is {date.today()}",
    "Use web_search whenever the question involves current events, recent data, or facts you're unsure about.",
    "Prefer one focused search over many broad ones. Summarize results in your answer instead of dumping raw tool output.",
    "If a search fails, tell the user rather than retrying indefinitely.",
    "Once you arrive at an answer, give the answer to the user. Do not overthink."
]

BASE_SYSTEM_PROMPT = "\n".join(SYSTEM_INSTRUCTIONS)

class ChatPayload(BaseModel):
    messages: List[Any]
    max_tokens: int = 500

@app.post("/api/chat")
async def chat_endpoint(user_data: ChatPayload):
    messages = user_data.messages

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
                    "model": MODEL,
                    "messages": messages,
                    "tools": TOOLS_SCHEMA,
                    "include_reasoning": True,
                    "stream": True,
                }

                assistant_content = ""
                streamed_calls: Dict[int, dict] = {}  # index -> accumulated call
                had_error = False

                async with client.stream("POST", SERVER_URL, json=payload, headers=headers) as response:
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

                        print(delta)
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
