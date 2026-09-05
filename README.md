# FogPilot

FogPilot is an adaptive multi-agent video dehazing system. The repository is
split into independently deployable services:

| Service | Directory | Responsibility | Local port |
|---|---|---|---:|
| Frontend | `frontend/` | React/Vite monitoring UI | 5173 |
| Backend | `backend/` + `fogpilot/` | FastAPI, WebSocket, video processing | 8000 |
| Database | MongoDB Atlas | Persistent frame metrics | managed |
| Reverse proxy | Caddy | Same-origin routing and HTTPS | 80/443 |

## Run locally without Docker

Backend:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

In a second terminal:

```powershell
cd frontend
npm install
$env:VITE_API_BASE_URL="http://localhost:8000"
npm run dev
```

Open `http://localhost:5173`. The backend falls back to local SQLite (`fogpilot.db`) when `DATABASE_URL` is
not set. For deployment, use MongoDB Atlas.

## Deploy all services with Docker Compose

1. Install Docker Desktop on Windows or Docker Engine on Linux.
2. Copy `.env.example` to `.env` and replace `POSTGRES_PASSWORD` with a strong
   value. For a real domain, set `FOGPILOT_DOMAIN=dashboard.example.com`.
3. Start the stack:

```powershell
docker compose up --build -d
```

4. Check the services:

```powershell
curl http://localhost/healthz
docker compose ps
docker compose logs -f backend
```

The Compose stack builds the backend and frontend separately and puts Caddy in
front of both services. Caddy
routes `/api/*`, `/ws`, `/healthz`, and `/metrics` to FastAPI and all other
paths to the frontend. With a public DNS record and a real domain, Caddy
automatically provisions HTTPS.

## Deploy each service independently

### Database

Use MongoDB Atlas for production. Create a free cluster, database user, and
database named `fogpilot`. Save the connection URL:

```text
mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority
```

Set that value as both `MONGODB_URI` and `DATABASE_URL` in the backend service,
and set `MONGODB_DATABASE=fogpilot`. The backend creates the `frame_metrics`
collection and index at startup. In Atlas Network Access, allow only the
backend's outbound IP range when your hosting plan supports static egress;
use `0.0.0.0/0` only temporarily during initial testing.

### Backend

Build from the repository root using `backend/Dockerfile`:

```powershell
docker build -f backend/Dockerfile -t fogpilot-backend .
docker run --rm -p 8000:8000 `
  -e DATABASE_URL="postgresql://..." `
  -e FOGPILOT_ALLOWED_ORIGINS="https://dashboard.example.com" `
  fogpilot-backend
```

The backend exposes:

- `GET /healthz`
- `GET /metrics`
- `POST /api/start`, `/api/stop`, `/api/upload`, `/api/config`
- `WS /ws`

Configure `FOGPILOT_CRITICAL_FOG_THRESHOLD`,
`FOGPILOT_MIN_FADE_IMPROVEMENT`, `FOGPILOT_MAX_CONSECUTIVE_SLOW_FRAMES`,
`FOGPILOT_MAX_ESCALATIONS`, `FOGPILOT_TARGET_FPS`, and
`FOGPILOT_MAX_UPLOAD_BYTES` through environment variables.

### Frontend

Build the static frontend:

```powershell
cd frontend
npm ci
$env:VITE_API_BASE_URL="https://api.example.com"
npm run build
```

Deploy `frontend/dist` to any static host (Cloudflare Pages, Netlify, Vercel,
S3/CloudFront, or Nginx). `VITE_API_BASE_URL` must point to the backend origin,
and that backend origin must be included in `FOGPILOT_ALLOWED_ORIGINS`. For a
same-domain Caddy deployment, leave `VITE_API_BASE_URL` empty.

## Testing

```powershell
py -3.12 -m pytest -q
```

The suite covers planner routing, critic decisions, end-to-end frame
processing, worker fallback, API health, configuration updates, and dashboard
serving. Frontend production compilation can be checked with:

```powershell
cd frontend
npm ci
npm run build
```
