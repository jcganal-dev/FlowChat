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
import asyncio
from dotenv import load_dotenv
import os

def run_crawl_sync(url: str):
    async def _crawl():
        from crawl4ai import AsyncWebCrawler
        async with AsyncWebCrawler(verbose=False) as crawler:
            result = await crawler.arun(url=url)
            return result.markdown if result else None
    return asyncio.run(_crawl())

def run_crawl_multi_sync(links: list):
    async def _crawl():
        from crawl4ai import AsyncWebCrawler
        res = []
        async with AsyncWebCrawler(verbose=False) as crawler:
            for link in links:
                try:
                    result = await crawler.arun(url=link)
                    res.append((link, result.markdown if result else None, None))
                except Exception as e:
                    res.append((link, None, str(e)))
        return res
    return asyncio.run(_crawl())

# Initialize SQLite database
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

@app.delete("/api/sandbox/delete/{filename:path}")
async def delete_sandbox_file(filename: str):
    file_path = os.path.join("sandbox", filename)
    if not os.path.exists(file_path):
        return JSONResponse(content={"message": "File/Folder already deleted"})
    try:
        if os.path.isdir(file_path):
            shutil.rmtree(file_path)
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
async def scrape_with_jina(req: ScrapeRequest):
    """
    Scrapes a webpage using Jina Reader.
    
    Args:
        req.url (str): The URL of the webpage to scrape.
    """
    target = req.url
    
    # Check if it looks like a URL
    is_url = target.startswith("http://") or target.startswith("https://") or ("." in target and " " not in target)
    target_url = target
    if is_url and not target.startswith("http"):
        target_url = "https://" + target
    
    markdown_content = None
    loop = asyncio.get_running_loop()
    if is_url:
        try:
            markdown_content = await loop.run_in_executor(None, run_crawl_sync, target_url)
        except Exception as e:
            print(f"Direct crawl failed: {e}")

    if markdown_content:
        return JSONResponse(content={"content": markdown_content})

    # If we are here, it failed or wasn't a URL. Send to ddgs
    links = []
    try:
        with DDGS(timeout=20) as ddgs:
            results = ddgs.text(target, max_results=2, backend="lite")
            for r in results:
                links.append(r.get("href"))
    except Exception as e:
        return JSONResponse(content={"error": f"DDGS failed: {e}", "content": None}, status_code=500)

    if not links:
        return JSONResponse(content={"error": "No results found on DDGS", "content": None}, status_code=404)

    # Crawl the links
    combined_markdown = f"# Search Results for: {target}\n\n"
    try:
        results = await loop.run_in_executor(None, run_crawl_multi_sync, links)
        for i, (link, md, err) in enumerate(results):
            if md:
                combined_markdown += f"## Source {i+1}: {link}\n\n{md}\n\n---\n\n"
            else:
                combined_markdown += f"## Source {i+1}: {link}\n\nFailed to scrape: {err}\n\n---\n\n"
    except Exception as e:
        return JSONResponse(content={"error": f"Crawler failed on links: {e}", "content": None}, status_code=500)

    return JSONResponse(content={"content": combined_markdown})

load_dotenv() 
API_KEY = os.getenv("API_KEY")
SERVER_URL = os.getenv("SERVER_URL")
MODEL = os.getenv("MODEL")
if not API_KEY:
    raise ValueError("API_KEY not found in .env file")
if not SERVER_URL:
    raise ValueError("SERVER_URL not found in .env file")
if not MODEL:
    raise ValueError("MODEL not found in .env file")

SYSTEM_INSTRUCTIONS = []

BASE_SYSTEM_PROMPT = "\n".join(SYSTEM_INSTRUCTIONS)

class ChatPayload(BaseModel):
    messages: List[Any]
    max_tokens: int = 500

@app.post("/api/chat")
async def chat_endpoint(user_data: ChatPayload):
    messages = user_data.messages
    
    if len(messages) > 0 and messages[0].get("role") == "system":
        original_content = messages[0].get("content", "")
        messages[0]["content"] = f"{BASE_SYSTEM_PROMPT}\n\n{original_content}"
    else:
        messages.insert(0, {"role": "system", "content": BASE_SYSTEM_PROMPT})

    payload = {
        "model": MODEL,
        "messages": user_data.messages,
        "include_reasoning": True,
        "stream": True
    }

    async def stream_generator():
        async with httpx.AsyncClient(timeout=None) as client:
            headers = {
                "Authorization": f"Bearer {API_KEY}",
                "Content-Type": "application/json"
            }
            async with client.stream("POST", SERVER_URL, json=payload, headers=headers) as response:  # type: ignore
                if response.status_code != 200:
                    error_body = await response.aread()
                    try:
                        err_json = json.loads(error_body.decode())
                        err_msg = err_json.get('error', {}).get('message', 'Unknown API Error')
                    except Exception:
                        err_msg = error_body.decode()
                        
                    yield json.dumps({"content": f"\n\n[API ERROR: HTTP {response.status_code} - {err_msg}]"}) + "\n"
                    return
                
                async for line in response.aiter_lines():
                    if line and line.startswith("data: "):
                        data_str = line[6:]

                        if data_str == "[DONE]":
                            break

                        try:
                            chunk = json.loads(data_str)
                            
                            if 'error' in chunk:
                                yield json.dumps({"content": f"\n\n[API ERROR: {chunk['error'].get('message', 'Unknown error')}]"}) + "\n"
                                break
                                
                            if 'choices' not in chunk or len(chunk['choices']) == 0:
                                continue
                                
                            delta = chunk['choices'][0]['delta']
                            
                            # OpenRouter uses 'reasoning', frontend expects 'reasoning_content'
                            if 'reasoning' in delta:
                                delta['reasoning_content'] = delta.pop('reasoning')
                                
                            yield json.dumps(delta) + "\n"
                        except (json.JSONDecodeError, KeyError, IndexError) as e:
                            continue
    
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
