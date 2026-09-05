import numpy as np

from fogpilot.orchestrator import FogPilotOrchestrator


def test_orchestrator_processes_frame():
    frame = np.full((48, 64, 3), 180, dtype=np.uint8)
    result = FogPilotOrchestrator().process_frame(frame, 1, 30.0)
    assert result.frame.shape == frame.shape
    assert result.metrics.frame_id == 1
    assert result.verdict.verdict == "PASS"


def test_orchestrator_raw_fallback_on_worker_error():
    runtime = FogPilotOrchestrator()
    runtime.workers["CAP"].process = lambda _: (_ for _ in ()).throw(RuntimeError("boom"))
    result = runtime.process_frame(np.zeros((16, 16, 3), dtype=np.uint8), 2, 30.0)
    assert result.verdict.degraded_output is True
