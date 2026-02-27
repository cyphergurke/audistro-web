# Web UI (Fan Playback)

Next.js App Router frontend for fan playback, access payment flow, boosts, and spend transparency.

## Features

- Playback via catalog-ranked providers with HLS fallback logic.
- Adaptive access token flow:
  - dev mode: direct `/v1/access/{assetId}`
  - non-dev mode: invoice challenge -> poll token exchange.
- Key retrieval via same-origin proxy route (`/api/hls-key/[assetId]`) for deterministic cookie + token handling.
- Boost/tip flow with invoice + polling.
- Boost history per asset.
- Spend dashboard (`/me/spend`) using device-scoped FAP ledger entries.
- Tokens stay in memory only. No token persistence in localStorage/sessionStorage.

## Main Pages

- `/` home + player + recent assets.
- `/asset/[assetId]` player, boost panel, boost history.
- `/me/spend` fan transparency dashboard ("Where did my money go").
- `/admin/payees` dev-only payee admin UI.

## Main API Routes (Next.js)

- Playback/HLS:
  - `GET /api/playback/[assetId]`
  - `GET /api/playlist/[assetId]`
  - `GET /api/hls-key/[assetId]`
- Access:
  - `POST /api/device/bootstrap`
  - `POST /api/access/[assetId]`
  - `POST /api/access/token`
  - `GET /api/access/grants?assetId=...`
- Boost:
  - `POST /api/boost`
  - `GET /api/boost/[boostId]?assetId=...`
  - `POST /api/boost/[boostId]/mark_paid?assetId=...` (dev-only in backend)
  - `GET /api/boost/list?assetId=...`
- Spend (device-scoped):
  - `GET /api/me/ledger`
  - `GET /api/me/spend-summary`

## Environment

Local example file: [`.env.local.example`](.env.local.example)

Important vars (server side):

- `CATALOG_BASE_URL` (default `http://localhost:18080`)
- `FAP_BASE_URL` (default `http://localhost:18081`)
- `PROVIDER_INTERNAL_BASE_URL` (default `http://localhost:18082`)

Dev admin vars:

- `NEXT_PUBLIC_DEV_ADMIN=true`
- `DEV_ADMIN_ALLOW_LNBITS_BASE_URLS=...`
- `NEXT_PUBLIC_DEV_ADMIN_DEFAULT_LNBITS_BASE_URL=http://lnbits:5000`

## Run With Docker Compose (Recommended)

From repo root:

```bash
docker compose up -d --build
```

Only rebuild web service:

```bash
docker compose up -d --no-deps --build web
```

Restart web only:

```bash
docker compose restart web
```

Logs:

```bash
docker compose logs -f web
```

## Run Web Locally (Without Dockerized web container)

```bash
cd web
pnpm install
pnpm dev
```

Then open: `http://localhost:3000`

## Quality Checks

```bash
cd web
pnpm test
pnpm typecheck
pnpm build
```

## Diagnostics / Smoke Scripts (repo root)

- `./scripts/test-ui.sh`
- `./scripts/smoke-e2e-playback.sh`
- `./scripts/smoke-paid-access.sh`
- `./scripts/check-provider-hls.sh http://localhost:18082/assets/asset1`
- `./scripts/e2e-ui-provider-fallback.sh`

## Security Notes

- Client never submits arbitrary upstream service URLs; server routes derive trusted targets.
- Access tokens are in-memory only.
- Recent library stores only asset IDs (no tokens/secrets).
- Spend dashboard is scoped to current browser device identity (`fap_device_id` cookie).
