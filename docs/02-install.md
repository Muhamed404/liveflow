# Install and run

> **In short:** one Docker container, one `.env` file, port 4000.

## What you need
- A Linux server with Docker and Docker Compose
- Network access **from that server** to every tool you will connect (Jenkins, ArgoCD, the Kubernetes API servers, Prometheus, Loki, Grafana, the GitHub API)

## 1. Get the code and create `.env`

```bash
git clone https://github.com/Muhamed404/liveflow.git
cd liveflow
cp backend/.env.example .env
```

Edit `.env` and set at least these two:

```bash
ENCRYPTION_KEY=      # openssl rand -base64 32
ADMIN_PASSWORD=      # the first admin's password (use 10+ characters)
```

> [!WARNING]
> Keep `ENCRYPTION_KEY` safe and **never commit `.env`**. Every token you enter is encrypted with it. If you lose it, you must enter all tokens again.

## 2. Start it

```bash
docker compose up -d --build
docker compose ps                         # liveflow ... (healthy)
curl -s localhost:4000/api/health         # {"status":"ok","auth_mode":"local"}
```

Open `http://<server>:4000` and sign in as `admin` with your `ADMIN_PASSWORD`.

## Settings you may need

| Variable | Default | When to change it |
|---|---|---|
| `ENCRYPTION_KEY` | — | **required** |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / — | first start only: creates the first admin when the database is empty |
| `COOKIE_SECURE` | `false` | set `true` when Liveflow is served over **HTTPS** |
| `TRUST_PROXY` | — | set `1` behind a load balancer or ingress |
| `SESSION_HOURS` | `12` | how long a sign-in lasts |
| `AUTH_MODE` | `local` | `off` only for demos: no sign-in, everyone is admin |

> [!IMPORTANT]
> Do not expose Liveflow to the internet without HTTPS. Operators can sync production from it.

## Users and roles

| Role | Can |
|---|---|
| **viewer** | see everything |
| **operator** | run pipelines, releases, rollbacks, Sync, stress tests, connection tests |
| **admin** | everything + Settings + users |

Add users in **Settings → Users**, or on the server: `docker compose exec liveflow npm run user:create -- <username> <role>`.

## Upgrade

```bash
git pull
docker compose up -d --build
```

Your data stays in the Docker volume `liveflow-data`.

## Back up

Everything (settings, users, activity log) is one SQLite file in the volume:

```bash
docker compose exec liveflow sh -c 'cp /data/config.db /data/config-backup.db'
docker cp $(docker compose ps -q liveflow):/data/config-backup.db ./liveflow-backup.db
```

Keep the backup **and** your `ENCRYPTION_KEY`: the backup is useless without the key.

## Try it without any tools (demo)

```bash
cd backend && npm install && AUTH_MODE=local npm run demo   # API + fake tools that move by themselves
cd frontend && npm install && npm run dev                  # http://localhost:5173
```

Sign in as `admin / demo-admin-123`, `sara / sara-demo-123` (operator) or `ahmed / ahmed-demo-123` (viewer).

---

| [← How Liveflow works](01-how-liveflow-works.md) | [Guide home](README.md) | [First setup, step by step →](03-first-setup.md) |
|:---|:---:|---:|
