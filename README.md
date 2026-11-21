# Liveflow

**One screen for your whole delivery path.** See what Jenkins is building, what ArgoCD will deploy and what runs in each environment — and open the production gate when you are ready.

![The Flow page](docs/images/flow-page.png)

- **Watch:** GitHub → Jenkins → ArgoCD → Kubernetes (or Docker Compose) as one live path, with pods per service, metrics, logs and one timeline of who did what.
- **Act:** run pipelines, create versioned releases, roll back, run k6 load tests.
- **Stay safe:** production never changes by itself — someone types `prod` and presses **Sync**. Roles, confirmations and an activity log on every action.

> Version **0.5.5** · Node 20 · one Docker image (API + dashboard) · SQLite

## Try it in two minutes (no tools needed)

```bash
cd backend && npm install && AUTH_MODE=local npm run demo   # API + fake tools that move by themselves
cd frontend && npm install && npm run dev                  # http://localhost:5173
```

Sign in as `admin / demo-admin-123` · `sara / sara-demo-123` (operator) · `ahmed / ahmed-demo-123` (viewer).

## Run it for real

```bash
cp backend/.env.example .env      # set ENCRYPTION_KEY (openssl rand -base64 32) and ADMIN_PASSWORD
docker compose up -d --build      # http://<server>:4000
```

Then follow **[First setup, step by step](docs/03-first-setup.md)**.

## Guide

| | |
|---|---|
| [How Liveflow works](docs/01-how-liveflow-works.md) | the idea, the words it uses, the safety rules |
| [Install and run](docs/02-install.md) | server, `.env`, HTTPS, users, upgrade, backup |
| [First setup, step by step](docs/03-first-setup.md) | from an empty Liveflow to a green delivery path |
| [Connect each tool](docs/04-integrations.md) | exact token, permission and URL for GitHub, Jenkins, ArgoCD, Kubernetes, Prometheus, Loki, Grafana |
| [Environments](docs/05-environments.md) | every field, several services per environment, the rules |
| [Using it every day](docs/06-daily-use.md) | deploy, release, the gate, rollback, stress tests |
| [What your Jenkinsfiles must do](docs/07-jenkins-contract.md) | parameters, stages, image tags |
| [Troubleshooting](docs/08-troubleshooting.md) | every common error and its fix |
| [Full example: retail-store](docs/09-example-retail-store.md) | a complete real configuration |
| [API reference](docs/api-reference.md) | for people who build on the API |

Infrastructure checklist: **[REQUIREMENTS.md](REQUIREMENTS.md)** · Full project handoff: **[PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)**

## Roles

| Role | Can |
|---|---|
| viewer | watch everything |
| operator | run pipelines, releases, rollbacks, Sync, stress tests, connection tests |
| admin | all of that + settings + users |

## Tests

```bash
cd backend && npm test     # 186 checks: logic, API, adapters, actions, UI shapes, auth, TLS / CSRF / tenant quirks
cd frontend && npm test    # 27 UI tests against fixtures captured from the real API
```

Browser walkthrough against the demo: `python frontend/e2e/flows.py` (see the file header).

## Next

- First run against the real retail-store infrastructure: compare with [REQUIREMENTS.md](REQUIREMENTS.md) and fix whatever differs
- Deploy to AWS (single container + volume; the image is ready)

