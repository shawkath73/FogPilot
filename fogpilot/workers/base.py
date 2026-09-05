"""Common worker metrics."""

import time
from abc import ABC, abstractmethod

import cv2
import numpy as np

from ..types import Algorithm, Metrics


class Worker(ABC):
    algorithm: Algorithm

    @staticmethod
    def _dark_mean(frame: np.ndarray) -> float:
        minimum = np.min(frame.astype(np.float32) / 255.0, axis=2)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
        return float(np.mean(cv2.erode(minimum, kernel)))

    def run(self, frame: np.ndarray, frame_id: int) -> tuple[np.ndarray, Metrics]:
        start = time.perf_counter()
        output = self.process(frame)
        elapsed = (time.perf_counter() - start) * 1000
        input_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).astype(np.float32)
        output_gray = cv2.cvtColor(output, cv2.COLOR_BGR2GRAY).astype(np.float32)
        contrast_gain = float((np.std(output_gray) - np.std(input_gray)) / max(np.std(input_gray), 1.0))
        fog_reduction = float(self._dark_mean(output) - self._dark_mean(frame))
        fade_improvement = float(max(0.0, fog_reduction * 10.0 + contrast_gain * 2.0))
        return output, Metrics(frame_id, self.algorithm, elapsed, fog_reduction, fade_improvement, contrast_gain)

    @abstractmethod
    def process(self, frame: np.ndarray) -> np.ndarray:
        raise NotImplementedError
