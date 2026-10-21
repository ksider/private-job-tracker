# Self-Hosted Job Tracker

Private LAN-only job tracker with a Manifest V3 browser collector. The extension captures a **read-only snapshot only after you press Save Job**; it never clicks, scrolls, observes page changes, reads cookies, or contacts the source SaaS. The only request it makes while saving is to the backend URL you configure.

## Run with Docker

1. For local Docker Compose, copy `.env.example` to `.env` and set a strong `API_TOKEN` value. For a Git-based Portainer stack, set `API_TOKEN` and `AI_SECRETS_KEY` in Portainer's **Environment variables** instead; `.env` is intentionally not stored in Git.
2. Keep `BIND_IP=127.0.0.1` for host-only access. To permit LAN access, explicitly set it to the Docker host's LAN IP, such as `192.168.1.100`.
3. Run `docker compose up -d --build`.
4. Open `http://<server-ip>:3000`.

HTTP on a trusted LAN is supported, but it exposes the API token and captured job data to the network. Use HTTPS and set `COOKIE_SECURE=true` when you later place it behind a trusted LAN TLS proxy. The service is never exposed publicly by default.

## Install the extension

```bash
npm install
npm run build
```

In Chrome, open `chrome://extensions`, enable Developer Mode, choose **Load unpacked**, and select the `extension` directory. Open the extension's Settings page, enter the tracker URL and API token, grant the requested permission for that exact server, and test the connection.

For a LinkedIn job view/search or a supported Workday/SuccessFactors vacancy, click **Save Job**. The Workday collector saves the complete safe job-posting container (including the company sidebar), so improved parsers can reprocess it later. For another site, select the relevant content before clicking Save Job; the generic collector otherwise reads only `main` or `article`, never the whole body. If the tracker is unavailable, the sanitized snapshot remains in IndexedDB and can be retried later without revisiting the original site.

## Development and verification

```bash
npm test
npm run build
API_TOKEN=dev-token npm run dev
```

Tests cover fixture parsing, import deduplication, preservation of status/notes, backend HTML sanitization, bearer authorization, and static browser read-only constraints. Tests run only against local fixtures and never against LinkedIn.

## Security model

- `POST /api/snapshots/import` requires an extension bearer token. The web tracker has no login: any device that reaches the LAN service can view and edit jobs.
- Raw HTML is sanitized at the extension and again at the backend. The UI receives only the safe backend rendering form.
- The parser registry consists of pure local HTML parsers. There is no fetch, headless browser, or source-site client in the server.
- Sanitized snapshots and normalized jobs are separated in the same SQLite database. Reparse reads the latest stored snapshot and preserves a job's status and notes; backups therefore remain atomic and do not require a separate snapshot directory.

The app has no cloud services, telemetry, third-party APIs, Redis, or PostgreSQL requirement.

## AI matching

The tracker can optionally send a saved vacancy description and the local candidate profile from `.ai/` to an AI provider selected in **AI Providers**. `AI_SECRETS_KEY` is used by the backend to encrypt provider keys in SQLite; if it is omitted, the existing `API_TOKEN` is used as the encryption key. The browser never receives saved keys and the extension never calls an AI API.

Matching is manual. The first analysis for each provider asks for confirmation before the profile is sent. Results are evidence-checked against the saved vacancy text and existing profile evidence IDs; the final category is calculated locally. For Docker, `.ai/` is mounted read-only at `/app/.ai`. You can also upload a profile JSON in **AI Providers**; it is validated and stored locally in the persistent `/data` volume, never in Git, and takes priority over the file from `.ai/`.
