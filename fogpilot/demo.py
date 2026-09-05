"""Run a dependency-light smoke demo using a generated foggy frame."""

import json

import cv2
import numpy as np

from .orchestrator import FogPilotOrchestrator


def main() -> None:
    base = np.zeros((240, 320, 3), dtype=np.uint8)
    cv2.rectangle(base, (40, 40), (280, 200), (40, 120, 220), -1)
    foggy = cv2.addWeighted(base, 0.45, np.full_like(base, 210), 0.55, 0)
    runtime = FogPilotOrchestrator()
    result = runtime.process_frame(foggy, frame_id=1, pipeline_fps=24.0)
    print(json.dumps({
        "sensor": result.sensor.to_dict(),
        "decision": result.decision.to_dict(),
        "metrics": result.metrics.to_dict(),
        "verdict": result.verdict.to_dict(),
        "report": runtime.logger.report(),
    }, indent=2))


if __name__ == "__main__":
    main()
