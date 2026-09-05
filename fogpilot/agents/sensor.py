"""Sensor agent: measure a frame without making routing decisions."""

import time

import cv2
import numpy as np

from ..types import SensorState


class SensorAgent:
    """Compute compact frame statistics used by the planner."""

    SYSTEM_PROMPT = """You are the Sensor Agent. Measure fog, scene complexity,
brightness, and FPS headroom. Never dehaze or make routing decisions."""

    def __init__(self, target_fps: float = 30.0) -> None:
        if target_fps <= 0:
            raise ValueError("target_fps must be positive")
        self.target_fps = target_fps

    @staticmethod
    def _dark_channel(frame: np.ndarray, size: int = 15) -> np.ndarray:
        minimum = np.min(frame, axis=2)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (size, size))
        return cv2.erode(minimum, kernel)

    def analyze(
        self, frame: np.ndarray, frame_id: int, pipeline_fps: float, timestamp: float | None = None
    ) -> SensorState:
        if frame.ndim != 3 or frame.shape[2] != 3:
            raise ValueError("frame must be a BGR image with shape (height, width, 3)")
        normalized = frame.astype(np.float32) / 255.0
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        dark_mean = float(np.mean(self._dark_channel(normalized)))
        fog_density = float(np.clip(1.0 - dark_mean, 0.0, 1.0))
        edges = cv2.Canny(frame, 80, 160)
        scene_complexity = float(np.clip(np.count_nonzero(edges) / edges.size * 8.0, 0.0, 1.0))
        brightness_mean = float(np.mean(gray) / 255.0)
        brightness_std = float(np.std(gray) / 255.0)
        headroom = (self.target_fps - pipeline_fps) / self.target_fps
        return SensorState(
            frame_id=frame_id,
            timestamp=time.time() if timestamp is None else timestamp,
            fog_density_score=round(fog_density, 6),
            scene_complexity=round(scene_complexity, 6),
            fps_headroom=round(headroom, 6),
            brightness_mean=round(brightness_mean, 6),
            brightness_std=round(brightness_std, 6),
        )
