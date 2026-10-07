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
from keys.apikeys import APIKeys

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

# (Place this under your app initialization and CORS middleware)
app.mount("/static", StaticFiles(directory="static"), name="static")

os.makedirs("sandbox", exist_ok=True)
app.mount("/sandbox", StaticFiles(directory="sandbox"), name="sandbox")
templates = Jinja2Templates(directory="templates")

@app.get("/api/sandbox/files")
async def get_sandbox_files():
    files = []
    for root, _, filenames in os.walk("sandbox"):
        for filename in filenames:
            rel_dir = os.path.relpath(root, "sandbox")
            if rel_dir == ".":
                rel_dir = ""
            filepath = os.path.join(rel_dir, filename).replace("\\", "/")
            files.append(filepath)
    return JSONResponse(content={"files": files})

@app.post("/api/sandbox/upload")
async def upload_file(files: List[UploadFile] = File(...)):
    saved = []
    for file in files:
        if file.filename is None:
            raise HTTPException(status_code=400, detail="Uploaded file must have a filename")
        file_path = os.path.join("sandbox", file.filename)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        saved.append(file.filename)
    return JSONResponse(content={"message": "Uploaded successfully", "files": saved})

@app.delete("/api/sandbox/delete/{filename:path}")
async def delete_sandbox_file(filename: str):
    file_path = os.path.join("sandbox", filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    try:
        os.remove(file_path)
        return JSONResponse(content={"message": "File deleted successfully"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/", response_class=HTMLResponse)
async def serve_canvas(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"request": request},
    )



OPENROUTER_SERVER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_API_KEY = APIKeys().get_key()

# Define your base rules
SYSTEM_INSTRUCTIONS = []

# Combine them into a single string with newlines
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
        "model": "apodex/apodex-1.1-mini:free",
        # "model": "openrouter/free",
        # "provider": {
        #     "ignore": ["HuggingFace"] # Add provider names here to exclude their endpoints
        # },
        "messages": user_data.messages,
        "include_reasoning": True,
        # "max_tokens": user_data.max_tokens,
        "temperature": 0.2,
        "repetition_penalty": 1.15,
        "frequency_penalty": 0.3,
        "presence_penalty": 0.2,
        "top_k": 80,
        "stream": True
    }

    async def stream_generator():
        async with httpx.AsyncClient(timeout=None) as client:
            headers = {
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json"
            }
            async with client.stream("POST", OPENROUTER_SERVER_URL, json=payload, headers=headers) as response:
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
                            print(delta)
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
