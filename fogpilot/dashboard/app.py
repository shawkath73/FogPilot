"""FastAPI control plane and WebSocket stream for FogPilot."""

import asyncio
import base64
import ipaddress
import os
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
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
app.add_middleware(CORSMiddleware, allow_origins=[item.strip() for item in settings.allowed_origins.split(",")], allow_credentials=True, allow_methods=["GET", "POST", "DELETE", "OPTIONS"], allow_headers=["*"])
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
_remote_image: np.ndarray | None = None
_demo_image_path = str(Path(__file__).resolve().parents[1] / "assets" / "demo-fog-road.png")
_latest_payload: dict[str, Any] | None = None
_session_history: deque[dict[str, Any]] = deque(maxlen=100)
_session_usage = {name: 0 for name in ("DCP", "CAP", "CLAHE", "Retinex")}
_session_escalations: deque[dict[str, Any]] = deque(maxlen=20)


class ConfigUpdate(BaseModel):
    critical_fog_threshold: float = Field(ge=0, le=1)
    min_fade_improvement: float = Field(ge=0)
    max_consecutive_slow_frames: int = Field(ge=1)
    max_escalations: int = Field(ge=0)


class MediaUrl(BaseModel):
    url: str = Field(min_length=8, max_length=2048)


def _image_data(frame: np.ndarray, size: tuple[int, int] = (320, 180), quality: int = 60) -> str:
    frame = cv2.resize(frame, size, interpolation=cv2.INTER_AREA)
    success, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
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
    global _frame_id, _video_path, _media_kind, _remote_image, _latest_payload
    capture = cv2.VideoCapture(_video_path) if _video_path else None
    still = _remote_image if _remote_image is not None else (cv2.imread(_video_path) if _video_path and _media_kind == "image" else None)
    preview_cache: dict[str, str] = {}
    if _media_kind == "video" and (capture is None or not capture.isOpened()):
        event("media_read_error", media_type="video", reason="video capture could not be opened")
        await _broadcast({"type": "media_error", "message": "The MP4 could not be decoded by the backend."})
        if capture:
            capture.release()
        return
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
                    success, fog = capture.read()
                    if not success:
                        event("media_read_error", media_type="video", reason="video frame could not be decoded")
                        await _broadcast({"type": "media_error", "message": "The MP4 was accepted but no video frames could be decoded."})
                        break
            else:
                fog = cv2.imread(_demo_image_path, cv2.IMREAD_COLOR)
                if fog is None:
                    raw = np.zeros((360, 640, 3), dtype=np.uint8)
                    cv2.rectangle(raw, (100, 80), (540, 290), (45, 125, 220), -1)
                    fog = cv2.addWeighted(raw, 0.5, np.full_like(raw, 205), 0.5, 0)
            result = await asyncio.to_thread(orchestrator.process_frame, fog, _frame_id, 30.0)
            metrics = result.metrics
            algorithm_images = dict(preview_cache)
            active_algorithm = result.decision.selected_algorithm
            algorithm_images[active_algorithm] = _image_data(result.frame, (220, 124), 48)
            if _frame_id % 10 == 0:
                async def build_preview(algorithm: str, worker: Any) -> tuple[str, str | None]:
                    try:
                        candidate = await asyncio.to_thread(worker.process, fog)
                        return algorithm, _image_data(candidate, (220, 124), 48)
                    except Exception as exc:
                        event("algorithm_preview_error", frame_id=_frame_id, algorithm=algorithm, error=str(exc))
                        return algorithm, None

                previews = await asyncio.gather(*[
                    build_preview(algorithm, worker)
                    for algorithm, worker in orchestrator.workers.items()
                    if algorithm != active_algorithm
                ])
                for algorithm, image in previews:
                    if image:
                        algorithm_images[algorithm] = image
                preview_cache = algorithm_images
            payload = {
                "frame_id": _frame_id, "algorithm": result.decision.selected_algorithm,
                "reason": result.decision.reason, "fps": round(1000 / max(metrics.processing_time_ms, 0.01), 2),
                "fade_improvement": metrics.fade_improvement, "contrast_gain": metrics.contrast_gain,
                "degraded_output": result.verdict.degraded_output,
                "escalation": {"reason": result.verdict.escalation_instruction} if result.verdict.escalation_instruction else None,
                "raw_image": _image_data(fog), "output_image": _image_data(result.frame),
                "algorithm_images": algorithm_images,
            }
            try:
                database.record(metrics.to_dict(), result.verdict.degraded_output)
            except Exception as exc:
                event("database_record_error", error=str(exc), frame_id=_frame_id)
            session_summary = orchestrator.logger.report()
            _latest_payload = payload
            _session_history.append({
                "frame_id": payload["frame_id"],
                "fps": payload["fps"],
                "fade_improvement": payload["fade_improvement"],
                "contrast_gain": payload["contrast_gain"],
            })
            _session_usage[payload["algorithm"]] += 1
            if payload["escalation"]:
                _session_escalations.appendleft({
                    "frame_id": payload["frame_id"],
                    "reason": payload["escalation"]["reason"],
                    "algorithm": payload["algorithm"],
                })
            await _broadcast(payload)
            await _broadcast({"type": "summary", **session_summary})
            await asyncio.sleep(1 / 10)
    finally:
        if capture:
            capture.release()


async def _stop_stream() -> None:
    global _running, _stream_task, _video_path, _media_kind, _remote_image, _latest_payload
    _running = False
    task = _stream_task
    _stream_task = None
    if task and task is not asyncio.current_task():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    if _video_path and _video_path.startswith(tempfile.gettempdir()):
        try:
            os.unlink(_video_path)
        except FileNotFoundError:
            pass
    _video_path = None
    _media_kind = None
    _remote_image = None
    _latest_payload = None
    _session_history.clear()
    _session_escalations.clear()
    for algorithm in _session_usage:
        _session_usage[algorithm] = 0


@app.get("/")
def dashboard() -> JSONResponse:
    return JSONResponse({"service": "fogpilot-backend", "frontend": "deploy frontend separately"})


@app.get("/healthz")
@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/summary")
def summary() -> dict:
    return orchestrator.logger.report()


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
    await _stop_stream()
    event("stream_stopped")
    return {"status": "stopped"}


@app.post("/api/reset")
async def reset_statistics() -> dict[str, str]:
    orchestrator.logger.reset()
    _session_history.clear()
    _session_escalations.clear()
    for algorithm in _session_usage:
        _session_usage[algorithm] = 0
    await _broadcast({
        "type": "snapshot",
        "history": [],
        "usage": dict(_session_usage),
        "escalations": [],
        "summary": orchestrator.logger.report(),
    })
    return {"status": "reset"}


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
    global _video_path, _media_kind, _remote_image, _running, _stream_task
    video_extensions = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
    image_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in video_extensions | image_extensions:
        raise HTTPException(status_code=415, detail="unsupported media type; use a video or image file")
    await _stop_stream()
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
    _remote_image = None
    _media_kind = "image" if suffix in image_extensions else "video"
    if _media_kind == "image":
        valid = await asyncio.to_thread(_valid_image, _video_path)
    else:
        valid = await asyncio.to_thread(_valid_video, _video_path)
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


def _validate_remote_url(value: str) -> str:
    parsed = urllib.parse.urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(status_code=422, detail="media URL must use HTTP or HTTPS")
    try:
        address = ipaddress.ip_address(parsed.hostname)
        if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved:
            raise HTTPException(status_code=422, detail="private or local media URLs are not allowed")
    except ValueError:
        pass
    return value.strip()


def _load_remote_image(url: str) -> np.ndarray:
    request = urllib.request.Request(url, headers={"User-Agent": "FogPilot/1.0"})
    with urllib.request.urlopen(request, timeout=20) as response:
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > 20 * 1024 * 1024:
            raise ValueError("remote image is larger than 20 MB")
        data = response.read(20 * 1024 * 1024 + 1)
    if len(data) > 20 * 1024 * 1024:
        raise ValueError("remote image is larger than 20 MB")
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("remote URL did not contain a decodable image")
    return image


@app.post("/api/media-url")
async def load_media_url(media: MediaUrl) -> dict[str, str]:
    global _video_path, _media_kind, _remote_image, _running, _stream_task
    url = _validate_remote_url(media.url)
    suffix = Path(urllib.parse.urlparse(url).path).suffix.lower()
    image_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    video_extensions = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m3u8"}
    await _stop_stream()
    if suffix in image_extensions:
        try:
            _remote_image = await asyncio.to_thread(_load_remote_image, url)
        except (OSError, ValueError, urllib.error.URLError) as exc:
            raise HTTPException(status_code=422, detail=f"remote image could not be loaded: {exc}") from exc
        _video_path = url
        _media_kind = "image"
    else:
        if suffix not in video_extensions:
            raise HTTPException(status_code=415, detail="URL must point to a supported image or video")
        _video_path = url
        _media_kind = "video"
        _remote_image = None
        valid = await asyncio.to_thread(_valid_video, url)
        if not valid:
            _video_path = None
            _media_kind = None
            raise HTTPException(status_code=422, detail="remote video could not be opened or decoded by the backend")
    _running = True
    _stream_task = asyncio.create_task(_demo_stream())
    event("media_url_loaded", media_type=_media_kind)
    return {"status": "accepted", "media_type": _media_kind, "url": url}


def _valid_image(path: str) -> bool:
    return cv2.imread(path, cv2.IMREAD_COLOR) is not None


def _valid_video(path: str) -> bool:
    probe = cv2.VideoCapture(path)
    try:
        if not probe.isOpened():
            return False
        success, frame = probe.read()
        return bool(success and frame is not None and frame.size)
    finally:
        probe.release()


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
        if _latest_payload:
            await websocket.send_json(_latest_payload)
        await websocket.send_json({
            "type": "snapshot",
            "history": list(_session_history),
            "usage": _session_usage,
            "escalations": list(_session_escalations),
            "summary": orchestrator.logger.report(),
        })
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        _clients.discard(websocket)
