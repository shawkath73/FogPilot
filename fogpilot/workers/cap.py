import cv2
import numpy as np

from .base import Worker


class CAPWorker(Worker):
    algorithm = "CAP"

    def process(self, frame: np.ndarray) -> np.ndarray:
        b, g, r = cv2.split(frame.astype(np.float32) / 255.0)
        chroma = np.maximum.reduce([r, g, b]) - np.minimum.reduce([r, g, b])
        brightness = (r + g + b) / 3.0
        transmission = np.clip(1.0 - 0.7 * brightness - 0.4 * chroma, 0.1, 1.0)
        image = frame.astype(np.float32) / 255.0
        atmospheric = np.percentile(image.reshape(-1, 3), 99, axis=0)
        result = (image - atmospheric) / transmission[:, :, None] + atmospheric
        return np.clip(result * 255, 0, 255).astype(np.uint8)
