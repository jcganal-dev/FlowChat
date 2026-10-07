import json
import httpx
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from typing import List, Any
from keys.apikeys import APIKeys



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
templates = Jinja2Templates(directory="templates")

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
SYSTEM_INSTRUCTIONS = [
    "Trust your previous responses, do not rethink them, unless explicitly specified by the user.",
    "You do not always have to state your sources, only do it if it is necessary or if the user asks for it.",
    "Be concise, say only what needs to be said (e.g., if a user says 'Hi!', respond with a brief greeting).",
    "Stop thinking when you have the answer. Do not overthink.",
    "Use LaTeX formatting for math, prefer $$\\int_0^\\infty$$ rather than ∫₀^∞."
]

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
        "model": "openrouter/free",
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
                async for line in response.aiter_lines():
                    if line and line.startswith("data: "):
                        data_str = line[6:]

                        if data_str == "[DONE]":
                            break

                        try:
                            chunk = json.loads(data_str)
                            delta = chunk['choices'][0]['delta']
                            
                            # OpenRouter uses 'reasoning', frontend expects 'reasoning_content'
                            if 'reasoning' in delta:
                                delta['reasoning_content'] = delta.pop('reasoning')
                                
                            yield json.dumps(delta) + "\n"
                        except json.JSONDecodeError:
                            continue
    
    return StreamingResponse(stream_generator(), media_type="text/event-stream")
