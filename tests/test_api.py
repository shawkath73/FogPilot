from fastapi.testclient import TestClient

from fogpilot.dashboard.app import app


def test_healthz_and_dashboard():
    client = TestClient(app)
    assert client.get("/healthz").json() == {"status": "ok"}
    assert client.get("/").status_code == 200


def test_config_update():
    client = TestClient(app)
    response = client.post("/api/config", json={
        "critical_fog_threshold": 0.7,
        "min_fade_improvement": 1.2,
        "max_consecutive_slow_frames": 3,
        "max_escalations": 1,
    })
    assert response.status_code == 200
