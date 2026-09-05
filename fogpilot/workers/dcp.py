import cv2
import numpy as np

from .base import Worker


class DCPWorker(Worker):
    algorithm = "DCP"

    def process(self, frame: np.ndarray) -> np.ndarray:
        image = frame.astype(np.float32) / 255.0
        dark = np.min(image, axis=2)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
        dark = cv2.erode(dark, kernel)
        atmospheric = np.percentile(image[dark >= np.percentile(dark, 99)], 99, axis=0)
        transmission = 1.0 - 0.8 * cv2.erode(np.min(image / np.maximum(atmospheric, 1e-3), axis=2), kernel)
        transmission = np.clip(transmission, 0.1, 1.0)
        result = (image - atmospheric) / transmission[:, :, None] + atmospheric
        return np.clip(result * 255, 0, 255).astype(np.uint8)
