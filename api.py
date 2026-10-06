import json
import httpx
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Any

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

LLMA_SERVER_URL = "http://127.0.0.1:8000/v1/chat/completions"

class ChatPayload(BaseModel):
    messages: List[Any]
    max_tokens: int = 500

@app.post("/api/chat")
async def chat_endpoint(user_data: ChatPayload):

    payload = {
        "model": "qwen",
        "messages": user_data.messages,
        "max_tokens": user_data.max_tokens,
        "temperature": 0.7,
        "stream": True
    }

    async def stream_generator():
        async with httpx.AsyncClient() as client:
            async with client.stream("POST", LLMA_SERVER_URL, json=payload) as response:
                async for line in response.aiter_lines():
                    if line and line.startswith("data: "):
                        data_str = line[6:]

                        if data_str == "[DONE]":
                            break

                        try:
                            chunk = json.loads(data_str)
                            delta = chunk['choices'][0]['delta']

                            if 'content' in delta and 'role' not in delta:
                                yield delta['content']
                        except json.JSONDecodeError:
                            continue
    
    return StreamingResponse(stream_generator(), media_type="text/event-stream")