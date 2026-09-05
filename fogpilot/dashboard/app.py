"""FastAPI control plane and WebSocket stream for FogPilot."""

import asyncio
import base64
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..config import Settings, settings
from ..database import Database
from ..observability import event
from ..orchestrator import FogPilotOrchestrator

@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    await stop()
    database.close()


app = FastAPI(title="FogPilot Dashboard", version="0.2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[item.strip() for item in settings.allowed_origins.split(",")], allow_credentials=True, allow_methods=["GET", "POST"], allow_headers=["*"])
orchestrator = FogPilotOrchestrator(config=settings)
database = Database()
try:
    database.initialize()
except Exception as exc:
    event("database_init_error", error=str(exc))
_clients: set[WebSocket] = set()
_stream_task: asyncio.Task[None] | None = None
_running = False
_frame_id = 0
_video_path: str | None = None
_media_kind: str | None = None


class ConfigUpdate(BaseModel):
    critical_fog_threshold: float = Field(ge=0, le=1)
    min_fade_improvement: float = Field(ge=0)
    max_consecutive_slow_frames: int = Field(ge=1)
    max_escalations: int = Field(ge=0)


def _image_data(frame: np.ndarray) -> str:
    frame = cv2.resize(frame, (320, 180), interpolation=cv2.INTER_AREA)
    success, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 60])
    if not success:
        return ""
    return "data:image/jpeg;base64," + base64.b64encode(encoded).decode("ascii")


async def _broadcast(payload: dict[str, Any]) -> None:
    dead: list[WebSocket] = []
    for client in _clients:
        try:
            await client.send_json(payload)
        except Exception:
            dead.append(client)
    for client in dead:
        _clients.discard(client)


async def _demo_stream() -> None:
    global _frame_id, _video_path, _media_kind
    capture = cv2.VideoCapture(_video_path) if _video_path else None
    still = cv2.imread(_video_path) if _video_path and _media_kind == "image" else None
    if _media_kind == "image" and still is None:
        event("media_read_error", media_type="image")
        return
    try:
        while _running:
            _frame_id += 1
            if _media_kind == "image":
                fog = still.copy()
            elif capture:
                success, fog = capture.read()
                if not success:
                    capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
            else:
                raw = np.zeros((360, 640, 3), dtype=np.uint8)
                cv2.rectangle(raw, (100, 80), (540, 290), (45, 125, 220), -1)
                fog = cv2.addWeighted(raw, 0.5, np.full_like(raw, 205), 0.5, 0)
            result = orchestrator.process_frame(fog, _frame_id, 30.0)
            metrics = result.metrics
            payload = {
                "frame_id": _frame_id, "algorithm": result.decision.selected_algorithm,
                "reason": result.decision.reason, "fps": round(1000 / max(metrics.processing_time_ms, 0.01), 2),
                "fade_improvement": metrics.fade_improvement, "contrast_gain": metrics.contrast_gain,
                "degraded_output": result.verdict.degraded_output,
                "escalation": {"reason": result.verdict.escalation_instruction} if result.verdict.escalation_instruction else None,
                "raw_image": _image_data(fog), "output_image": _image_data(result.frame),
            }
            try:
                database.record(metrics.to_dict(), result.verdict.degraded_output)
            except Exception as exc:
                event("database_record_error", error=str(exc), frame_id=_frame_id)
            await _broadcast(payload)
            await asyncio.sleep(1 / 10)
    finally:
        if capture:
            capture.release()


@app.get("/")
def dashboard() -> JSONResponse:
    return JSONResponse({"service": "fogpilot-backend", "frontend": "deploy frontend separately"})


@app.get("/healthz")
@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/summary")
def summary() -> dict:
    return orchestrator.logger.summary()


@app.get("/api/report")
def report() -> dict:
    return orchestrator.logger.report()


@app.get("/metrics")
def metrics() -> str:
    report_data = orchestrator.logger.report()
    return "\n".join([
        "# HELP fogpilot_frames_processed Total accepted frames.",
        "# TYPE fogpilot_frames_processed counter",
        f"fogpilot_frames_processed {report_data['frames_processed']}",
        "# HELP fogpilot_escalations_total Total critic escalations.",
        "# TYPE fogpilot_escalations_total counter",
        f"fogpilot_escalations_total {report_data['escalations']}",
        "# HELP fogpilot_mean_fps Mean observed FPS.",
        "# TYPE fogpilot_mean_fps gauge",
        f"fogpilot_mean_fps {report_data['mean_fps']}",
    ]) + "\n"


@app.post("/api/start")
async def start() -> dict[str, str]:
    global _stream_task, _running
    if not _running:
        _running = True
        _stream_task = asyncio.create_task(_demo_stream())
        event("stream_started")
    return {"status": "running"}


@app.post("/api/stop")
async def stop() -> dict[str, str]:
    global _running, _stream_task, _video_path, _media_kind
    _running = False
    if _stream_task:
        _stream_task.cancel()
        _stream_task = None
    if _video_path:
        try:
            os.unlink(_video_path)
        except FileNotFoundError:
            pass
        _video_path = None
        _media_kind = None
        _video_path = None
        _media_kind = None
    event("stream_stopped")
    return {"status": "stopped"}


@app.post("/api/config")
def update_config(update: ConfigUpdate) -> dict[str, Any]:
    updated = Settings(
        critical_fog_threshold=update.critical_fog_threshold,
        min_fade_improvement=update.min_fade_improvement,
        max_consecutive_slow_frames=update.max_consecutive_slow_frames,
        max_escalations=update.max_escalations,
        target_fps=settings.target_fps,
        max_upload_bytes=settings.max_upload_bytes,
        allowed_origins=settings.allowed_origins,
    )
    orchestrator.update_config(updated)
    return {"status": "updated", "config": update.model_dump()}


@app.post("/api/upload")
async def upload_media(file: UploadFile = File(...)) -> dict[str, str]:
    global _video_path, _media_kind, _running, _stream_task
    video_extensions = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
    image_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in video_extensions | image_extensions:
        raise HTTPException(status_code=415, detail="unsupported media type; use a video or image file")
    if _stream_task:
        _stream_task.cancel()
        _stream_task = None
    _running = False
    if _video_path:
        try:
            os.unlink(_video_path)
        except FileNotFoundError:
            pass
    with tempfile.NamedTemporaryFile(prefix="fogpilot-", suffix=suffix, delete=False) as target:
        total = 0
        while chunk := await file.read(1024 * 1024):
            total += len(chunk)
            if total > settings.max_upload_bytes:
                target.close()
                os.unlink(target.name)
                await file.close()
                raise HTTPException(status_code=413, detail=f"file is too large; maximum is {settings.max_upload_bytes // (1024 * 1024)} MB")
            target.write(chunk)
    await file.close()
    _video_path = target.name
    _media_kind = "image" if suffix in image_extensions else "video"
    if _media_kind == "image":
        decoded = cv2.imread(_video_path, cv2.IMREAD_COLOR)
        valid = decoded is not None
    else:
        probe = cv2.VideoCapture(_video_path)
        valid = bool(probe.isOpened())
        probe.release()
    if not valid:
        os.unlink(_video_path)
        _video_path = None
        _media_kind = None
        raise HTTPException(status_code=422, detail="file could not be decoded as a valid image or video")
    if not _running:
        _running = True
        _stream_task = asyncio.create_task(_demo_stream())
    event("media_uploaded", filename=file.filename, media_type=_media_kind, bytes=total)
    return {"status": "accepted", "media_type": _media_kind, "filename": file.filename or "media"}


@app.delete("/api/media")
async def remove_media() -> dict[str, str]:
    await stop()
    return {"status": "removed"}


@app.get("/api/status")
def status() -> dict[str, bool | str | None]:
    return {"backend_active": True, "stream_running": _running, "media_type": _media_kind}


@app.websocket("/ws")
async def websocket_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    _clients.add(websocket)
    try:
        await websocket.send_json({"type": "summary", **orchestrator.logger.summary()})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        _clients.discard(websocket)
