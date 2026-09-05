import numpy as np

from fogpilot.agents.critic import CriticAgent
from fogpilot.agents.planner import PlannerAgent
from fogpilot.types import Metrics, SensorState


def state(fog=0.8, headroom=0.1, complexity=0.2):
    return SensorState(1, 0.0, fog, complexity, headroom, 0.5, 0.1)


def test_planner_prefers_cap_for_dense_fog():
    assert PlannerAgent().route(state()).selected_algorithm == "CAP"


def test_planner_uses_clahe_when_over_budget():
    assert PlannerAgent().route(state(fog=0.4, headroom=-0.1)).selected_algorithm == "CLAHE"


def test_critic_fails_dense_fog_with_low_improvement():
    metrics = Metrics(1, "DCP", 2.0, 0.0, 0.2, 0.1)
    verdict = CriticAgent().evaluate(metrics, state())
    assert verdict.verdict == "FAIL"
    assert verdict.escalation_instruction
