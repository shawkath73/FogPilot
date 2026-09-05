"""Structured logging and basic process metrics."""

import json
import logging
import time

logger = logging.getLogger("fogpilot")
logging.basicConfig(level=logging.INFO, format="%(message)s")


def event(name: str, **fields: object) -> None:
    logger.info(json.dumps({"event": name, "timestamp": time.time(), **fields}, default=str))
