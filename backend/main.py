"""
main.py - AgentVoiceHub Backend Server.

A FastAPI-based voice-controlled AI agent interface providing:
- WebSocket streaming for real-time voice interaction
- Edge TTS speech synthesis (Chinese + English)
- Speech-to-text endpoint (web speech API / faster-whisper)
- Agent proxy endpoints for OpenClaw and Hermes
- Custom voice upload and session management

Run: uvicorn main:app --host 0.0.0.0 --port 8765 --reload
"""

import asyncio
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import aiofiles
import httpx
from fastapi import FastAPI, File, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from voice_engine import VoiceEngine

# ---------------------------------------------------------------------------
# Configuration (from environment, no hardcoded secrets)
# ---------------------------------------------------------------------------

OPENCLAW_URL = os.getenv("OPENCLAW_URL", "http://127.0.0.1:18789")
HERMES_URL = os.getenv("HERMES_URL", "http://127.0.0.1:8080")
UPLOAD_DIR = Path(os.getenv("VOICE_UPLOAD_DIR", "./uploads/voices"))
MAX_UPLOAD_SIZE = int(os.getenv("MAX_UPLOAD_MB", "10")) * 1024 * 1024
SESSION_TTL_MINUTES = int(os.getenv("SESSION_TTL_MINUTES", "60"))
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8765"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("agentvoicehub")

# ---------------------------------------------------------------------------
# Session management
# ---------------------------------------------------------------------------


class Session:
    """Represents a user interaction session."""

    def __init__(self, session_id: str) -> None:
        self.id = session_id
        self.created_at = datetime.utcnow()
        self.last_active = datetime.utcnow()
        self.history: list[dict] = []

    def touch(self) -> None:
        self.last_active = datetime.utcnow()

    def add_message(self, role: str, content: str) -> None:
        self.history.append({"role": role, "content": content, "ts": datetime.utcnow().isoformat()})
        self.touch()

    @property
    def expired(self) -> bool:
        return datetime.utcnow() - self.last_active > timedelta(minutes=SESSION_TTL_MINUTES)


class SessionManager:
    """Thread-safe session store with automatic expiry."""

    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def create(self) -> Session:
        sid = str(uuid.uuid4())
        session = Session(sid)
        self._sessions[sid] = session
        return session

    def get(self, session_id: str) -> Optional[Session]:
        session = self._sessions.get(session_id)
        if session and session.expired:
            del self._sessions[session_id]
            return None
        if session:
            session.touch()
        return session

    def delete(self, session_id: str) -> bool:
        return self._sessions.pop(session_id, None) is not None

    def cleanup(self) -> int:
        """Remove expired sessions. Returns count removed."""
        expired = [sid for sid, s in self._sessions.items() if s.expired]
        for sid in expired:
            del self._sessions[sid]
        return len(expired)

    @property
    def active_count(self) -> int:
        return len(self._sessions)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    voice: str = Field(default="zh-CN-XiaoxiaoNeural")
    rate: str = Field(default="+0%", pattern=r"^[+-]\d+%$")
    pitch: str = Field(default="+0Hz", pattern=r"^[+-]\d+Hz$")


class STTRequest(BaseModel):
    """Placeholder for server-side STT (client uses Web Speech API primarily)."""
    audio_format: str = Field(default="webm", pattern=r"^(webm|wav|mp3)$")
    language: str = Field(default="zh-CN")


class AgentMessage(BaseModel):
    message: str = Field(..., min_length=1, max_length=10000)
    session_id: Optional[str] = None
    stream: bool = False


class SessionResponse(BaseModel):
    session_id: str
    created_at: str


# ---------------------------------------------------------------------------
# Application lifespan
# ---------------------------------------------------------------------------

voice_engine = VoiceEngine()
session_manager = SessionManager()
http_client: Optional[httpx.AsyncClient] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    http_client = httpx.AsyncClient(timeout=30.0)
    logger.info("AgentVoiceHub backend starting on %s:%s", HOST, PORT)
    yield
    await http_client.aclose()
    logger.info("AgentVoiceHub backend stopped")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="AgentVoiceHub",
    description="Voice-controlled AI agent interface backend",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Health & info endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "active_sessions": session_manager.active_count,
    }


@app.get("/")
async def root():
    return {"name": "AgentVoiceHub", "version": "0.1.0", "docs": "/docs"}


# ---------------------------------------------------------------------------
# Session endpoints
# ---------------------------------------------------------------------------


@app.post("/sessions", response_model=SessionResponse)
async def create_session():
    session = session_manager.create()
    return SessionResponse(session_id=session.id, created_at=session.created_at.isoformat())


@app.get("/sessions/{session_id}")
async def get_session(session_id: str):
    session = session_manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    return {
        "session_id": session.id,
        "created_at": session.created_at.isoformat(),
        "last_active": session.last_active.isoformat(),
        "message_count": len(session.history),
    }


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    if not session_manager.delete(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"deleted": True}


# ---------------------------------------------------------------------------
# TTS endpoints
# ---------------------------------------------------------------------------


@app.get("/tts/voices")
async def list_voices(language: Optional[str] = Query(None, description="Filter by locale, e.g. zh-CN")):
    voices = await voice_engine.list_voices(language)
    return {"voices": voices, "count": len(voices)}


@app.post("/tts/synthesize")
async def synthesize_speech(req: TTSRequest):
    """Synthesize text to speech and return MP3 audio."""
    try:
        audio = await voice_engine.synthesize(text=req.text, voice=req.voice, rate=req.rate, pitch=req.pitch)
        return Response(content=audio, media_type="audio/mpeg")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("TTS error: %s", e)
        raise HTTPException(status_code=500, detail="Speech synthesis failed")


@app.post("/tts/stream")
async def stream_speech(req: TTSRequest):
    """Stream TTS audio chunks."""
    async def audio_generator():
        async for chunk in voice_engine.synthesize_stream(
            text=req.text, voice=req.voice, rate=req.rate, pitch=req.pitch
        ):
            yield chunk

    return StreamingResponse(audio_generator(), media_type="audio/mpeg")


# ---------------------------------------------------------------------------
# STT endpoints (server-side fallback; primary STT is client Web Speech API)
# ---------------------------------------------------------------------------


@app.post("/stt/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    language: str = Query("zh-CN"),
):
    """
    Server-side STT endpoint. Accepts audio file upload.
    Requires faster-whisper installed; returns 501 if unavailable.
    Client should prefer Web Speech API for real-time transcription.
    """
    try:
        from faster_whisper import WhisperModel  # type: ignore

        model = WhisperModel("base", device="cpu", compute_type="int8")
        audio_bytes = await file.read()
        tmp_path = UPLOAD_DIR / f"stt_{uuid.uuid4().hex}.webm"
        async with aiofiles.open(tmp_path, "wb") as f:
            await f.write(audio_bytes)

        segments, info = model.transcribe(str(tmp_path), language=language.split("-")[0])
        text = " ".join(seg.text for seg in segments)
        tmp_path.unlink(missing_ok=True)
        return {"text": text, "language": info.language, "confidence": 1.0}

    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="Server-side STT not available. Use Web Speech API on the client.",
        )
    except Exception as e:
        logger.error("STT error: %s", e)
        raise HTTPException(status_code=500, detail="Transcription failed")


# ---------------------------------------------------------------------------
# Custom voice upload
# ---------------------------------------------------------------------------


@app.post("/voices/upload")
async def upload_voice(
    name: str = Query(..., min_length=1, max_length=50),
    file: UploadFile = File(...),
):
    """Upload a custom voice sample (WAV/MP3). Registered for future voice cloning."""
    if file.content_type not in ("audio/wav", "audio/mpeg", "audio/x-wav", "audio/webm"):
        raise HTTPException(status_code=400, detail="Unsupported audio format. Use WAV or MP3.")

    content = await file.read()
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail=f"File exceeds {MAX_UPLOAD_SIZE // (1024*1024)}MB limit")

    # Sanitize name
    safe_name = "".join(c for c in name if c.isalnum() or c in "-_").strip()
    if not safe_name:
        raise HTTPException(status_code=400, detail="Invalid voice name")

    ext = Path(file.filename or "audio.wav").suffix or ".wav"
    save_path = UPLOAD_DIR / f"{safe_name}{ext}"
    async with aiofiles.open(save_path, "wb") as f:
        await f.write(content)

    voice_engine.register_custom_voice(safe_name, str(save_path))
    return {"name": safe_name, "path": str(save_path), "size": len(content)}


@app.get("/voices/custom")
async def list_custom_voices():
    return {"voices": voice_engine.list_custom_voices()}


# ---------------------------------------------------------------------------
# Agent proxy endpoints
# ---------------------------------------------------------------------------


async def _proxy_agent(base_url: str, message: str, session_id: Optional[str]) -> dict:
    """Forward a message to an upstream AI agent."""
    payload = {"message": message}
    if session_id:
        payload["session_id"] = session_id
    try:
        resp = await http_client.post(f"{base_url}/chat", json=payload, timeout=30.0)
        resp.raise_for_status()
        return resp.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Agent timed out")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        logger.error("Agent proxy error (%s): %s", base_url, e)
        raise HTTPException(status_code=502, detail="Agent unavailable")


@app.post("/agents/openclaw")
async def openclaw_chat(msg: AgentMessage):
    """Proxy chat to OpenClaw agent (port 18789)."""
    result = await _proxy_agent(OPENCLAW_URL, msg.message, msg.session_id)
    if msg.session_id:
        session = session_manager.get(msg.session_id)
        if session:
            session.add_message("user", msg.message)
            session.add_message("assistant", result.get("response", ""))
    return result


@app.post("/agents/hermes")
async def hermes_chat(msg: AgentMessage):
    """Proxy chat to Hermes agent."""
    result = await _proxy_agent(HERMES_URL, msg.message, msg.session_id)
    if msg.session_id:
        session = session_manager.get(msg.session_id)
        if session:
            session.add_message("user", msg.message)
            session.add_message("assistant", result.get("response", ""))
    return result


# ---------------------------------------------------------------------------
# WebSocket for real-time voice interaction
# ---------------------------------------------------------------------------


@app.websocket("/ws/voice")
async def voice_websocket(ws: WebSocket):
    """
    WebSocket endpoint for real-time voice interaction.

    Protocol (JSON messages from client):
      {"type": "start", "session_id": "...", "voice": "zh-CN-XiaoxiaoNeural"}
      {"type": "text", "text": "Hello", "agent": "openclaw"}
      {"type": "tts", "text": "Say this", "voice": "..."}
      {"type": "stop"}

    Server responds with:
      {"type": "audio", "data": "<base64 mp3>"}
      {"type": "text", "text": "...", "agent": "..."}
      {"type": "error", "message": "..."}
    """
    await ws.accept()
    session_id: Optional[str] = None
    default_voice = "zh-CN-XiaoxiaoNeural"
    logger.info("WebSocket client connected")

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "message": "Invalid JSON"})
                continue

            msg_type = msg.get("type")

            if msg_type == "start":
                session_id = msg.get("session_id")
                default_voice = msg.get("voice", default_voice)
                if session_id:
                    session = session_manager.get(session_id)
                    if not session:
                        session = session_manager.create()
                        session_id = session.id
                else:
                    session = session_manager.create()
                    session_id = session.id
                await ws.send_json({"type": "started", "session_id": session_id})

            elif msg_type == "text":
                text = msg.get("text", "").strip()
                agent = msg.get("agent", "openclaw")
                if not text:
                    continue

                # Record in session
                if session_id:
                    session = session_manager.get(session_id)
                    if session:
                        session.add_message("user", text)

                # Forward to agent
                base_url = OPENCLAW_URL if agent == "openclaw" else HERMES_URL
                try:
                    result = await _proxy_agent(base_url, text, session_id)
                    response_text = result.get("response", "")
                    if session_id:
                        session = session_manager.get(session_id)
                        if session:
                            session.add_message("assistant", response_text)
                    await ws.send_json({"type": "text", "text": response_text, "agent": agent})
                except HTTPException as e:
                    await ws.send_json({"type": "error", "message": str(e.detail)})

            elif msg_type == "tts":
                text = msg.get("text", "").strip()
                voice = msg.get("voice", default_voice)
                rate = msg.get("rate", "+0%")
                pitch = msg.get("pitch", "+0Hz")
                if not text:
                    continue
                try:
                    import base64
                    audio = await voice_engine.synthesize(text, voice=voice, rate=rate, pitch=pitch)
                    await ws.send_json({"type": "audio", "data": base64.b64encode(audio).decode()})
                except Exception as e:
                    await ws.send_json({"type": "error", "message": f"TTS failed: {e}"})

            elif msg_type == "stop":
                break

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error("WebSocket error: %s", e)
    finally:
        logger.info("WebSocket session ended (session=%s)", session_id)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=HOST, port=PORT, reload=True, log_level="info")
