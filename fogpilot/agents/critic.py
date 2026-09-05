"""Quality gate and escalation policy."""

from collections import deque

from ..types import Metrics, SensorState, Verdict


class CriticAgent:
    SYSTEM_PROMPT = """You are the Critic Agent. Pass acceptable output,
otherwise return an escalation instruction. Never choose the replacement."""

    def __init__(self, min_fade_improvement: float = 1.5, target_fps: float = 30.0, max_slow_frames: int = 5) -> None:
        self.min_fade_improvement = min_fade_improvement
        self.target_fps = target_fps
        self.max_slow_frames = max_slow_frames
        self._slow_frames = 0

    def evaluate(self, metrics: Metrics, sensor: SensorState) -> Verdict:
        if metrics.fade_improvement < self.min_fade_improvement and sensor.fog_density_score > 0.5:
            return Verdict(metrics.frame_id, "FAIL", "escalate: insufficient fog removal for dense-fog frame.")
        if metrics.contrast_gain < 0:
            return Verdict(metrics.frame_id, "FAIL", "escalate: negative contrast gain, structural degradation detected.")
        frame_ms = 1000.0 / self.target_fps
        self._slow_frames = self._slow_frames + 1 if metrics.processing_time_ms > frame_ms else 0
        if self._slow_frames > self.max_slow_frames:
            return Verdict(metrics.frame_id, "FAIL", "escalate: throughput violation, downgrade to faster algorithm.")
        return Verdict(metrics.frame_id, "PASS", None)
