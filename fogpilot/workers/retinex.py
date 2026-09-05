import cv2
import numpy as np

from .base import Worker


class RetinexWorker(Worker):
    algorithm = "Retinex"

    def process(self, frame: np.ndarray) -> np.ndarray:
        image = frame.astype(np.float32) + 1.0
        illumination = cv2.GaussianBlur(image, (0, 0), 30)
        result = np.log(image) - np.log(illumination + 1.0)
        result = cv2.normalize(result, None, 0, 255, cv2.NORM_MINMAX)
        return result.astype(np.uint8)
