# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 1.0.0 — Statch

First public release. A ground-up rework of the project into an open-source,
config-as-code, edge-native status page.

### Added
- **Config as code** — a single `status.config.yml` is the source of truth for
  branding, groups, monitors, thresholds and notification channels. The Worker
  reconciles it into D1 on deploy (hash-guarded, so unchanged config is a no-op),
  with `${SECRET}` interpolation from Worker secrets.
- **Auto-discovering agents** — Cloudflare-tunnel-style enrolment. Mint a
  one-shot token in the admin panel, run a one-liner on the machine, and it
  self-registers and goes live. Pairing codes removed entirely.
- **Richer monitoring** — response-time `degraded` state, HTTP status-code and
  body (keyword) assertions, TLS-failure detection, and N-consecutive-failure
  confirmation to suppress flapping.
- **Notification channels** — Slack, Telegram, Microsoft Teams, PagerDuty and
  generic templated webhooks, alongside the existing Discord embeds and Web Push.
- **RSS/Atom feed** of incidents at `/rss.xml`.
- **Deploy-to-Cloudflare button** that provisions the D1 database automatically.
- Released under the **GNU GPLv3**. Copyright © 2026 Mr_chank (chank.dev · github.com/chank-op).

### Changed
- Rebranded to **Statch** (a placeholder any fork can rename via config).
- Redesigned the admin panel with a polished, dark, tabbed shell.
- Write-reduction: healthy HTTP/TCP monitors now persist state only on change
  (plus an occasional refresh). A day with no downtime is 100% and writes ~nothing.
- Cloudflare outage auto-blame kept and genericised (and its comments made funnier).

### Removed
- The AwdevSoftware hardware-probe integration and all provider-specific code.
