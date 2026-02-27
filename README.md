# Web UI (Fan Playback)

This folder contains the Next.js App Router frontend (`web`) for local fan playback testing.

## Prerequisites

- Docker + Docker Compose
- Run commands from the repo root: `/home/goku/code/audiostr`

## First Start (Full Stack)

Use this once (or when backend images also changed):

```bash
docker compose up -d --build
```

## Rebuild Only Web Container

If you only changed files in `./web`, use:

```bash
docker compose up -d --no-deps --build web
```

What this does:
- rebuilds only the `web` image
- recreates only the `web` container
- does not rebuild/restart `audicatalog`, `fap`, or `audiprovider_*`

## Restart Web Without Rebuild

```bash
docker compose restart web
```

## Common Web-Only Commands

Check status:

```bash
docker compose ps web
```

Follow logs:

```bash
docker compose logs -f web
```

Open shell in container:

```bash
docker compose exec web sh
```

Force clean rebuild for web (no cache):

```bash
docker compose build --no-cache web
docker compose up -d --no-deps web
```

Stop/remove only web container:

```bash
docker compose stop web
docker compose rm -f web
```

## Provider HLS Diagnostic (No UI)

Compare sequential vs parallel segment fetching directly against a provider:

```bash
./scripts/check-provider-hls.sh http://localhost:18082/assets/asset1
```

Try a known broken provider:

```bash
./scripts/check-provider-hls.sh http://localhost:18083/assets/asset1
```

End-to-end sequential fetch budget test (via `web` APIs: access + playback + playlist):

```bash
./scripts/e2e-sequential-fetch.sh
```

UI-style provider fallback + sequential fetch budget test:

```bash
./scripts/e2e-ui-provider-fallback.sh
```

Create more synthetic debug assets:

```bash
./scripts/create-more-debug-samples.sh
```

Import a local MP3/audio file and convert to HLS for streaming:

```bash
./scripts/import-mp3-sample.sh asset_mp3_1 ~/Music/demo.mp3
```

Notes:
- The script writes HLS files to `audiprovider_eu_1` and seeds `audicatalog`.
- Only asset metadata is persisted; tokens remain memory-only in the web app.

## URLs

- UI: `http://localhost:3000`
- UI health endpoint: `http://localhost:3000/api/health`

## Notes

- Tokens are not persisted by the frontend.
- Recent asset IDs may be stored in browser localStorage (asset IDs only).
