<div align="center">

# Statch

**An edge-native, config-as-code status page that runs entirely on a single Cloudflare Worker.**

No server to babysit. No database to host. Globally distributed, effectively free.

[![Runs on Cloudflare Workers](https://img.shields.io/badge/runs%20on-Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![License: GPL v3](https://img.shields.io/github/license/Vapourware-Studios/status-page?color=blue)](./LICENSE)
[![Stars](https://img.shields.io/github/stars/Vapourware-Studios/status-page?style=flat&logo=github)](https://github.com/Vapourware-Studios/status-page/stargazers)
[![Issues](https://img.shields.io/github/issues/Vapourware-Studios/status-page)](https://github.com/Vapourware-Studios/status-page/issues)
[![Last commit](https://img.shields.io/github/last-commit/Vapourware-Studios/status-page)](https://github.com/Vapourware-Studios/status-page/commits)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Vapourware-Studios/status-page)

</div>

---

Statch is a self-hosted status page for people who'd rather commit a YAML file than click around a dashboard. Define your monitors, groups, branding, and alert channels in [`status.config.yml`](./status.config.yml); deploy; done. Everything else — incidents, maintenance, subscribers — is handled from the admin panel.

**Stack:** Hono · D1 + Drizzle ORM · React + Vite + Tailwind v4 · Cloudflare Cron

## Why Statch

- **Runs on one Worker.** Uptime Kuma needs an always-on box; Statch rides the Cloudflare edge for ~$0 and never sleeps.
- **Config as code.** Your whole setup lives in one version-controlled `status.config.yml`. Edit → deploy → it reconciles itself.
- **Barely touches the database.** Only *state changes* are written. A day with no downtime writes nothing and reads as 100%.
- **Auto-discovering agents.** Enrol a machine the way you'd run a Cloudflare Tunnel: copy a one-liner, paste it on the box, it shows up. No pairing codes.
- **Rich monitoring.** HTTP/TCP/push/keyword checks, response-time **degraded** state, status-code & body assertions, TLS-failure detection, dead-man's-switch heartbeats, and N-failure confirmation to kill flapping.
- **Alerts everywhere.** Discord (rich embeds), Slack, Telegram, Microsoft Teams, PagerDuty, generic webhooks, Web Push, and an RSS feed.
- **"It's not you, it's Cloudflare."** When a monitor drops, Statch checks Cloudflare's own status page and, if the orange cloud is on fire, says so on the incident.

## Quick start

### One-click

Hit the **Deploy to Cloudflare** button above. It forks the repo, creates the `statch-db` D1 database defined in [`wrangler.jsonc`](./wrangler.jsonc), applies migrations, and deploys the Worker. Then set your secrets (below).

### From your machine

```bash
git clone https://github.com/Vapourware-Studios/status-page && cd statch
npm install

# 1. Create the database and paste its id into wrangler.jsonc
npx wrangler d1 create statch-db

# 2. Apply migrations
npm run db:migrate:remote

# 3. Secrets
npx wrangler secret put ADMIN_PASSWORD    # password for /admin
npx wrangler secret put SESSION_SECRET     # any random 32+ char string

# 4. Edit status.config.yml to taste, then ship it
npm run deploy
```

Local dev: `npm run dev` (Vite + Miniflare, local D1) → http://localhost:5173.

## Configure everything in one file

[`status.config.yml`](./status.config.yml) is the source of truth. A taste:

```yaml
site:
  name: "Acme Status"
  accent: "#6366f1"

groups: ["Core Services", "Infrastructure"]

monitors:
  - slug: website
    name: "Website"
    group: "Core Services"
    type: http
    url: "https://acme.com"
    expectStatus: [200]
    degradedResponseMs: 800   # slower than this → "degraded"
    checkSsl: true
    checkCloudflare: true

  - slug: api
    name: "API"
    type: keyword             # body must contain a string
    url: "https://acme.com/health"
    expectBody: "ok"

  - slug: worker
    name: "Background Worker"
    group: "Infrastructure"
    type: push                # dead-man's-switch heartbeat
    grace: 90

notifications:
  slack:
    - url: "${SLACK_WEBHOOK_URL}"   # ${SECRET} → set via `wrangler secret put`
  telegram:
    - botToken: "${TG_BOT_TOKEN}"
      chatId: "${TG_CHAT_ID}"
```

Secrets are never committed — reference them as `${NAME}` and set them with `wrangler secret put NAME`. On deploy, the Worker reconciles this file into D1 within a minute.

## Add a server to monitor (auto-discovery)

Admin → **Monitors → + Server** → name it → copy the one-liner:

```bash
curl -fsSL https://your-status-page/install.sh | STATCH_TOKEN=<token> sh
```

Run it on the machine. It enrols itself, starts heartbeating, and appears live. No pairing code to type back in. Uninstall with `statch-agent --uninstall`.

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/status` | — | Overall status + active incidents |
| GET | `/api/incidents` | — | Paginated incident history |
| GET | `/rss.xml` | — | RSS feed of incidents |
| POST | `/api/agents/enroll` | enrol token | Auto-discover a push monitor |
| POST | `/api/heartbeat` | agent token | Push monitor heartbeat |
| POST | `/api/admin/monitors/enroll-token` | cookie | Mint an enrolment one-liner |
| … | `/api/admin/*` | cookie | Full admin surface |

## Licence

**GNU General Public License v3.0** — see [LICENSE](./LICENSE).

Copyright © 2026 **Mr_chank** ([chank.dev](https://chank.dev) · [github.com/chank-op](https://github.com/chank-op)).

You're free to use, study, share, and modify Statch. If you distribute a modified version, it must also be GPLv3 and its source made available. It comes with no warranty.

<div align="center">
© 2026 <a href="https://chank.dev">Mr_chank</a> · <a href="https://github.com/chank-op">github.com/chank-op</a> · GPLv3
</div>
