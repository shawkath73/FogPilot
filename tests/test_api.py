from fastapi.testclient import TestClient
import cv2
import numpy as np

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


def test_image_upload_starts_stream():
    client = TestClient(app)
    response = client.post(
        "/api/upload",
        files={"file": ("sample.png", b"not-an-image", "image/png")},
    )
    assert response.status_code == 422


def test_valid_image_upload_is_accepted():
    image = np.full((24, 24, 3), 180, dtype=np.uint8)
    success, encoded = cv2.imencode(".png", image)
    assert success
    with TestClient(app) as client:
        response = client.post(
            "/api/upload",
            files={"file": ("sample.png", encoded.tobytes(), "image/png")},
        )
        assert response.status_code == 200
        assert response.json()["media_type"] == "image"
        client.post("/api/stop")
