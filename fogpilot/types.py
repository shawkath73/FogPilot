"""Shared typed data structures for the FogPilot pipeline."""

from dataclasses import asdict, dataclass
from typing import Any, Literal

Algorithm = Literal["DCP", "CAP", "CLAHE", "Retinex"]


@dataclass(frozen=True)
class SensorState:
    frame_id: int
    timestamp: float
    fog_density_score: float
    scene_complexity: float
    fps_headroom: float
    brightness_mean: float
    brightness_std: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class RouteDecision:
    frame_id: int
    selected_algorithm: Algorithm
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class Metrics:
    frame_id: int
    algorithm: Algorithm
    processing_time_ms: float
    fog_reduction: float
    fade_improvement: float
    contrast_gain: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class Verdict:
    frame_id: int
    verdict: Literal["PASS", "FAIL"]
    escalation_instruction: str | None
    degraded_output: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
