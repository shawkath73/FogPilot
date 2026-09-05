"""Read-only aggregate statistics for the dashboard and reports."""

from collections import deque
from statistics import mean
from typing import Any

from ..types import Metrics, Verdict


class LoggerAgent:
    SYSTEM_PROMPT = """You are the Logger Agent. Aggregate accepted metrics and
critic events without changing upstream data."""

    def __init__(self, summary_window: int = 100, target_fps: float = 30.0) -> None:
        self.summary_window = summary_window
        self.target_fps = target_fps
        self.records: deque[dict[str, Any]] = deque(maxlen=summary_window)
        self.escalations: deque[str] = deque(maxlen=summary_window)
        self.total_frames = 0
        self.total_escalations = 0

    def record(self, metrics: Metrics, verdict: Verdict) -> None:
        self.records.append({"metrics": metrics.to_dict(), "verdict": verdict.to_dict()})
        self.total_frames += 1
        if verdict.escalation_instruction:
            self.escalations.append(verdict.escalation_instruction)
            self.total_escalations += 1

    def summary(self) -> dict[str, Any]:
        algorithms = ("DCP", "CAP", "CLAHE", "Retinex")
        total = len(self.records)
        counts = {name: 0 for name in algorithms}
        for record in self.records:
            counts[record["metrics"]["algorithm"]] += 1
        usage = {name: round(counts[name] * 100 / total, 2) if total else 0.0 for name in algorithms}
        fps = [1000.0 / record["metrics"]["processing_time_ms"] for record in self.records if record["metrics"]["processing_time_ms"] > 0]
        compliant = [value for value in fps if value >= self.target_fps]
        return {
            "window_start_frame": self.records[0]["metrics"]["frame_id"] if total else 0,
            "window_end_frame": self.records[-1]["metrics"]["frame_id"] if total else 0,
            "algorithm_usage_pct": usage,
            "mean_fps": round(mean(fps), 3) if fps else 0.0,
            "escalations": self.total_escalations,
            "real_time_compliance_pct": round(len(compliant) * 100 / len(fps), 2) if fps else 0.0,
        }

    def report(self) -> dict[str, Any]:
        return {**self.summary(), "frames_processed": self.total_frames, "escalation_reasons": list(self.escalations)}
