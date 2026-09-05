"""Environment-backed runtime configuration."""

from dataclasses import dataclass
import os


def _float(name: str, default: float) -> float:
    value = os.getenv(name)
    return default if value is None else float(value)


def _int(name: str, default: int) -> int:
    value = os.getenv(name)
    return default if value is None else int(value)


@dataclass
class Settings:
    critical_fog_threshold: float = _float("FOGPILOT_CRITICAL_FOG_THRESHOLD", 0.75)
    min_fade_improvement: float = _float("FOGPILOT_MIN_FADE_IMPROVEMENT", 1.5)
    max_consecutive_slow_frames: int = _int("FOGPILOT_MAX_CONSECUTIVE_SLOW_FRAMES", 5)
    max_escalations: int = _int("FOGPILOT_MAX_ESCALATIONS", 2)
    target_fps: float = _float("FOGPILOT_TARGET_FPS", 30.0)
    max_upload_bytes: int = _int("FOGPILOT_MAX_UPLOAD_BYTES", 100 * 1024 * 1024)
    allowed_origins: str = os.getenv("FOGPILOT_ALLOWED_ORIGINS", "http://localhost:8000")

    def validate(self) -> None:
        if not 0 <= self.critical_fog_threshold <= 1:
            raise ValueError("critical_fog_threshold must be between 0 and 1")
        if self.min_fade_improvement < 0 or self.max_consecutive_slow_frames < 1:
            raise ValueError("quality thresholds must be non-negative")
        if self.max_escalations < 0 or self.target_fps <= 0 or self.max_upload_bytes <= 0:
            raise ValueError("limits must be positive")


settings = Settings()
settings.validate()
