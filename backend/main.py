"""Backend service entrypoint.

The orchestration implementation remains in the tested ``fogpilot`` package;
this module is the deployable API boundary used by the backend container.
"""

from fogpilot.dashboard.app import app

__all__ = ["app"]
