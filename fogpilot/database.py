"""Small persistence adapter for PostgreSQL in deployment and SQLite locally."""

import os
import sqlite3
from pathlib import Path
from typing import Any


class Database:
    def __init__(self, url: str | None = None) -> None:
        self.url = url or os.getenv("DATABASE_URL", "sqlite:///./fogpilot.db")
        self.sqlite_path = Path(self.url.removeprefix("sqlite:///"))

    def _postgres(self) -> Any:
        import psycopg
        return psycopg.connect(self.url)

    def _mongo(self) -> Any:
        from pymongo import MongoClient
        return MongoClient(self.url)

    def initialize(self) -> None:
        statement = """CREATE TABLE IF NOT EXISTS frame_metrics (
            id BIGSERIAL PRIMARY KEY, frame_id INTEGER NOT NULL, algorithm TEXT NOT NULL,
            processing_time_ms DOUBLE PRECISION NOT NULL, fade_improvement DOUBLE PRECISION NOT NULL,
            contrast_gain DOUBLE PRECISION NOT NULL, degraded_output BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"""
        if self.url.startswith(("mongodb://", "mongodb+srv://")):
            client = self._mongo()
            database_name = os.getenv("MONGODB_DATABASE", "fogpilot")
            client[database_name]["frame_metrics"].create_index("frame_id")
            client.close()
        elif self.url.startswith(("postgres://", "postgresql://")):
            with self._postgres() as connection:
                connection.execute(statement)
        else:
            self.sqlite_path.parent.mkdir(parents=True, exist_ok=True)
            with sqlite3.connect(self.sqlite_path) as connection:
                connection.execute(statement.replace("BIGSERIAL PRIMARY KEY", "INTEGER PRIMARY KEY AUTOINCREMENT").replace("DOUBLE PRECISION", "REAL").replace("BOOLEAN", "INTEGER").replace("TIMESTAMPTZ", "TEXT"))

    def record(self, metrics: dict[str, Any], degraded: bool) -> None:
        values = (metrics["frame_id"], metrics["algorithm"], metrics["processing_time_ms"], metrics["fade_improvement"], metrics["contrast_gain"], degraded)
        if self.url.startswith(("mongodb://", "mongodb+srv://")):
            client = self._mongo()
            database_name = os.getenv("MONGODB_DATABASE", "fogpilot")
            client[database_name]["frame_metrics"].insert_one({
                "frame_id": metrics["frame_id"],
                "algorithm": metrics["algorithm"],
                "processing_time_ms": metrics["processing_time_ms"],
                "fade_improvement": metrics["fade_improvement"],
                "contrast_gain": metrics["contrast_gain"],
                "degraded_output": degraded,
            })
            client.close()
        elif self.url.startswith(("postgres://", "postgresql://")):
            with self._postgres() as connection:
                connection.execute("INSERT INTO frame_metrics (frame_id, algorithm, processing_time_ms, fade_improvement, contrast_gain, degraded_output) VALUES (%s, %s, %s, %s, %s, %s)", values)
        else:
            with sqlite3.connect(self.sqlite_path) as connection:
                connection.execute("INSERT INTO frame_metrics (frame_id, algorithm, processing_time_ms, fade_improvement, contrast_gain, degraded_output) VALUES (?, ?, ?, ?, ?, ?)", values)
