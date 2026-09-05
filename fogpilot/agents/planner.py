"""Deterministic planner implementing the routing rules from the specification."""

from ..types import Algorithm, RouteDecision, SensorState


class PlannerAgent:
    SYSTEM_PROMPT = """You are the Planner Agent. Select exactly one worker
using real-time constraints first, then fog density and scene complexity."""
    CRITICAL_FOG_THRESHOLD = 0.75
    ESCALATION_ORDER: tuple[Algorithm, ...] = ("CLAHE", "CAP", "DCP")

    def route(self, state: SensorState, tried_algorithms: list[Algorithm] | None = None) -> RouteDecision:
        tried = set(tried_algorithms or [])
        if state.fps_headroom < 0:
            preferred: Algorithm = "CAP" if state.fog_density_score > self.CRITICAL_FOG_THRESHOLD else "CLAHE"
            reason = "rule 1: pipeline is behind budget"
        elif state.fog_density_score > 0.6:
            preferred, reason = "CAP", "rule 2: dense fog with budget available"
        elif 0.3 <= state.fog_density_score <= 0.6 and state.scene_complexity < 0.5:
            preferred, reason = "DCP", "rule 3: moderate fog and low scene complexity"
        else:
            preferred, reason = "CLAHE", "rule 1 fallback: efficient general-purpose enhancement"

        if tried_algorithms:
            for candidate in self.ESCALATION_ORDER:
                if candidate not in tried:
                    preferred = candidate
                    reason = f"rule 5: escalation to next untried algorithm after {', '.join(tried_algorithms)}"
                    break
        if preferred in tried:
            raise RuntimeError("planner exhausted all available algorithms")
        return RouteDecision(state.frame_id, preferred, reason)
