import cv2
import numpy as np

from .base import Worker


class CLAHEWorker(Worker):
    algorithm = "CLAHE"

    def __init__(self) -> None:
        self._clahe = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(2, 2))

    def process(self, frame: np.ndarray) -> np.ndarray:
        lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
        lab[:, :, 0] = self._clahe.apply(lab[:, :, 0])
        return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
