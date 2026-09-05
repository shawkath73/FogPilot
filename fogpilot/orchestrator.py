"""Bounded finite-state orchestration for one frame at a time."""

from dataclasses import dataclass

import numpy as np

from .agents import CriticAgent, LoggerAgent, PlannerAgent, SensorAgent
from .config import Settings, settings
from .observability import event
from .types import Algorithm, Metrics, RouteDecision, SensorState, Verdict
from .workers import CAPWorker, CLAHEWorker, DCPWorker, RetinexWorker, Worker


@dataclass(frozen=True)
class FrameResult:
    frame: np.ndarray
    sensor: SensorState
    decision: RouteDecision
    metrics: Metrics
    verdict: Verdict


class FogPilotOrchestrator:
    """Route frames and allow at most ``max_escalations`` retries."""

    def __init__(self, target_fps: float | None = None, max_escalations: int | None = None, config: Settings | None = None) -> None:
        config = config or settings
        target_fps = config.target_fps if target_fps is None else target_fps
        max_escalations = config.max_escalations if max_escalations is None else max_escalations
        if max_escalations < 0:
            raise ValueError("max_escalations cannot be negative")
        self.sensor = SensorAgent(target_fps)
        self.planner = PlannerAgent()
        self.planner.CRITICAL_FOG_THRESHOLD = config.critical_fog_threshold
        self.critic = CriticAgent(
            min_fade_improvement=config.min_fade_improvement,
            target_fps=target_fps,
            max_slow_frames=config.max_consecutive_slow_frames,
        )
        self.logger = LoggerAgent(target_fps=target_fps)
        self.workers: dict[Algorithm, Worker] = {
            "DCP": DCPWorker(), "CAP": CAPWorker(),
            "CLAHE": CLAHEWorker(), "Retinex": RetinexWorker(),
        }
        self.max_escalations = max_escalations

    def update_config(self, config: Settings) -> None:
        config.validate()
        self.planner.CRITICAL_FOG_THRESHOLD = config.critical_fog_threshold
        self.critic.min_fade_improvement = config.min_fade_improvement
        self.critic.max_slow_frames = config.max_consecutive_slow_frames
        self.max_escalations = config.max_escalations

    def process_frame(self, frame: np.ndarray, frame_id: int, pipeline_fps: float) -> FrameResult:
        try:
            sensor_state = self.sensor.analyze(frame, frame_id, pipeline_fps)
        except Exception as exc:
            event("sensor_error", frame_id=frame_id, error=str(exc))
            sensor_state = SensorState(frame_id, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
            decision = RouteDecision(frame_id, "CLAHE", "raw frame fallback: sensor failure")
            metrics = Metrics(frame_id, "CLAHE", 0.0, 0.0, 0.0, 0.0)
            verdict = Verdict(frame_id, "PASS", "raw frame fallback: sensor failure", degraded_output=True)
            self.logger.record(metrics, verdict)
            return FrameResult(frame, sensor_state, decision, metrics, verdict)
        tried: list[Algorithm] = []
        decision = self.planner.route(sensor_state)
        try:
            output, metrics = self.workers[decision.selected_algorithm].run(frame, frame_id)
        except Exception as exc:
            event("worker_error", frame_id=frame_id, algorithm=decision.selected_algorithm, error=str(exc))
            metrics = Metrics(frame_id, decision.selected_algorithm, 0.0, 0.0, 0.0, 0.0)
            verdict = Verdict(frame_id, "PASS", f"worker failure: {exc}", degraded_output=True)
            self.logger.record(metrics, verdict)
            return FrameResult(frame, sensor_state, decision, metrics, verdict)
        verdict = self.critic.evaluate(metrics, sensor_state)
        attempts = 0
        while verdict.verdict == "FAIL" and attempts < self.max_escalations:
            tried.append(decision.selected_algorithm)
            attempts += 1
            decision = self.planner.route(sensor_state, tried)
            try:
                output, metrics = self.workers[decision.selected_algorithm].run(frame, frame_id)
            except Exception as exc:
                event("worker_error", frame_id=frame_id, algorithm=decision.selected_algorithm, error=str(exc))
                continue
            verdict = self.critic.evaluate(metrics, sensor_state)
        if verdict.verdict == "FAIL":
            verdict = Verdict(verdict.frame_id, "PASS", verdict.escalation_instruction, degraded_output=True)
        self.logger.record(metrics, verdict)
        return FrameResult(output, sensor_state, decision, metrics, verdict)
