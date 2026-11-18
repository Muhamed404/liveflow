# Liveflow — Project Context (handoff)

> Upload this file (and the repo zip) at the start of a new chat. It contains everything decided and built so far.
> Last updated: 2026-11-18 · version **0.5.4**

---

## 1. What this is

A DevOps **portfolio / interview showcase**. An interviewer opens one dashboard and, without a terminal, can:

- release a new version (GitHub tag → Jenkins → ArgoCD → Kubernetes)
- watch the pipeline run, stage by stage, with the live Jenkins console
- open the **production gate** (manual ArgoCD sync) and watch the rolling update
- run a **k6 stress test** and watch the HPA add pods
- see pods, metrics (Prometheus), logs (Loki), Grafana, and a unified "what just happened" timeline
- switch between apps, environments (dev / staging / prod) and clusters

**Split of work:** Mohamed builds all DevOps/infra (clusters, Jenkinsfiles, ArgoCD, Prometheus, Loki, Grafana, k6 job). Claude writes the application code (backend + frontend) only.

**Working rules agreed in the conversation**
- Keep **`REQUIREMENTS.md`** (repo root) updated with every new Jenkins / infra / tool requirement, and add a **changelog** row each time.
- Mohamed prefers direct, practical answers; mixes Arabic and English; verifies outputs.
- Verify work for real (tests, screenshots in Chromium) before delivering.

---

## 2. Environments and delivery flow

| Env | Runtime | Deployed by | Trigger | ArgoCD sync |
|---|---|---|---|---|
| dev | **Docker Compose** on a dev server | Jenkins (SSH + `docker compose up -d`) | push to `dev` | — |
| staging | Kubernetes `cluster-stg` (on-prem) | ArgoCD | merge `dev → staging` | **auto** |
| prod | Kubernetes `cluster-prod` (on-prem, separate cluster) | ArgoCD | dashboard **Create release** | **manual** (dashboard **Sync** = the gate) |

Flow: developer pushes `dev` → Jenkins auto-deploys dev → PR `dev → staging` merges → Jenkins builds image `stg-<sha>`, updates `values-stg.yaml` → ArgoCD auto-syncs. Prod: dashboard creates tag `vX.Y.Z` on `main` + triggers Jenkins prod job (`VERSION`, `ACTION=release`) → Jenkins pushes image and updates `values-prod.yaml` → ArgoCD is **OutOfSync** and waits → someone clicks **Sync** (typing `prod`) → rolling update.

Repos: `target-app` (code + Jenkinsfiles), `k8s-infra` (Helm chart, `values-stg.yaml`, `values-prod.yaml`), `liveflow` (this dashboard).
The target app itself doesn't matter ("any app that runs").

---

## 3. Key decisions (and why)

| Decision | Why |
|---|---|
| **Replicas are never configured in the dashboard**; read live from Deployment + HPA | Mohamed's explicit requirement: values come from the cluster |
| **Jenkins stages come from the Jenkinsfile** (`/wfapi/describe`), rendered as data | Mohamed wants to change the pipeline freely; UI follows it. Needs *Pipeline Stage View* plugin |
| **Every station on the delivery path is backed by a real API** | A "Registry" station was removed because nothing read it (it duplicated Jenkins). "SSH deploy" removed for the same reason |
| Paths: k8s = `github → jenkins → argocd → cluster`; compose = `github → jenkins → dev_server` | |
| **Dev containers read via cAdvisor + Prometheus**, not the Docker API | Chosen by Mohamed: safer, no Docker socket exposure |
| Prod gate = **manual Sync from the dashboard** (not Jenkins input step) | Chosen by Mohamed |
| Prod Jenkins job has **no GitHub tag webhook** | Dashboard tags + triggers; a webhook would run it twice |
| Config split into `clusters`, `integrations`, `apps`, `environments` | One Jenkins/Prometheus serves many envs; change a token once |
| Backend computes the UI shapes (`path`, `gate`, `can`) | React only renders; logic tested in one place |
| Prod actions need `confirm: true` (UI: type the env name) | Safety |
| One pipeline / one stress test per env at a time (409) | Multiple interviewers at once |
| SQLite + in-memory cache/presence | Single instance is enough for a showcase |
| Design direction: **"Live flow"** — the delivery path is the hero | Mohamed rejected the first generic dashboard look and picked this |

---

## 4. Repo layout

```
liveflow/
├── README.md               run / deploy / env vars / roles / tests
├── REQUIREMENTS.md         everything infra must provide + changelog  (keep updated!)
├── PROJECT_CONTEXT.md      this file
├── Dockerfile              one image: API + built frontend
├── docker-compose.yml
├── backend/                Node 20, Express 4, better-sqlite3, zod, undici
│   ├── src/
│   │   ├── server.js            routes, auth wiring, CSP, static frontend
│   │   ├── config/env.js        env vars
│   │   ├── db/index.js          schema + lightweight migrations (addColumnIfMissing)
│   │   ├── crypto/secrets.js    AES-256-GCM for tokens
│   │   ├── adapters/            http.js (TLS, errors), jenkins, k8s, argocd, github, prometheus, queries, loki, grafana
│   │   ├── repositories/        clusters, integrations, apps, environments
│   │   ├── services/            context (resolveContext), observe, path, deploy, stress, events, activity,
│   │   │                        connectivity (tests), presence, auth
│   │   ├── routes/              clusters, integrations, apps, env-actions, auth (+users), schemas
│   │   ├── middleware/          errors, async, auth (authenticate, guards)
│   │   └── utils/               cache (TTL + in-flight dedup), semver
│   └── scripts/                 demo.js, mock-tools.js, create-user.js, *-test.js
└── frontend/               Vite 5, React 18.3, React Router 6, TanStack Query 5, IBM Plex (@fontsource)
    ├── src/
    │   ├── main.jsx, App.jsx (routes), auth.jsx (AuthGate, login, roles)
    │   ├── api/client.js, api/hooks.js
    │   ├── components/          Shell, DeliveryPath, FlowParts, Charts, forms, ui, Icon
    │   ├── pages/               FlowPage, RunsPage, ReleasesPage, StressPage, settings/{SettingsPage, EnvForm}
    │   ├── lib/                 format.js, headline.js (phase → title)
    │   ├── styles/app.css       tokens + all styles
    │   └── test/                vitest + fixtures captured from the real API
    └── e2e/flows.py             Playwright walkthrough (14 steps) against the demo
```

---

## 5. Data model (SQLite)

- **clusters**: `id, name, api_url, token_enc, ca_cert, insecure_skip_tls`
- **integrations**: `id, type (jenkins|github|argocd|prometheus|grafana|loki), name, base_url, username, token_enc, ca_cert, insecure_skip_tls, tenant_id`
- **apps**: `id, name, github_integration_id, github_repo (owner/repo)`
- **environments** (one per app+env, `UNIQUE(app_id,name)`): `name (dev|staging|prod), runtime (compose|k8s), deploy_mode (auto|manual; prod defaults manual), git_branch, cluster_id, namespace, deployment (one or more names, stored "a, b, c"; first = main service), compose_project, jenkins_integration_id, jenkins_job, argocd_integration_id, argocd_app, prometheus_integration_id, prom_selector, http_metric, http_status_label, loki_integration_id, loki_selector, grafana_integration_id, grafana_dashboard_uid, stress_job, stress_target_url`
- **activity**: `ts, actor, app_id, env, action, status (ok|failed), details`
- **users**: `username (NOCASE unique), display_name, role (viewer|operator|admin), password_hash (scrypt)`
- **sessions**: `token_hash (sha256), user_id, expires_at`

Rules: tokens/CA never returned by the API (`has_token`, `has_ca_cert`); names validated DNS-1123 (keeps PromQL/LogQL injection-safe); compose env requires Prometheus; k8s env requires cluster+namespace+deployment; integration type must match the column; `''` from forms is stored as `null`.

`resolveContext(appId, env)` (services/context.js) returns everything adapters need, with decrypted secrets — internal only.

---

## 6. API reference (all under `/api`)

Public: `GET /health`, `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`

Settings (admin; `POST .../test` = operator):
```
GET|POST /clusters            GET|PUT|DELETE /clusters/:id        POST /clusters/:id/test
GET|POST /integrations?type=  GET|PUT|DELETE /integrations/:id    POST /integrations/:id/test
GET|POST /apps                GET|PUT|DELETE /apps/:app
GET /apps/:app/environments   GET|PUT(upsert)|DELETE /apps/:app/environments/:env
POST /apps/:app/environments/:env/test       checks the exact job / deployment / argocd app / metrics / logs
GET|POST /users  PUT|DELETE /users/:id        (admin; keeps ≥1 admin; can't delete self; password change ends sessions)
```

Env actions `/apps/:app/environments/:env/...` (reads: any user; mutations: operator):
| Method | Path | Notes |
|---|---|---|
| GET | `/overview` | workload, metrics, pipeline, argocd sections (`{data}`/`{error}` each) + `path`, `gate`, `can`, `stress`, `features`, `role` |
| GET | `/workload` | pods (k8s) or containers (compose), `current` flag per pod, HPA |
| GET | `/metrics`, `/metrics/:metric?minutes=` | cpu_cores, memory_bytes, rps, error_rate; range adds `markers` (deploys, stress) |
| GET | `/logs?limit&minutes&contains` | Loki, newest first, level detected |
| GET | `/events?limit` | merged timeline: user, jenkins, argocd, k8s, hpa; `sources_failed` |
| GET/POST | `/builds` | list / trigger (dev & staging only) |
| GET | `/builds/:n`, `/builds/:n/log?start=`, `/queue/:id` | stages, trigger, commit, image, progressive console |
| GET/POST | `/releases` | prod only: `{live_version, pending_version, latest_tag, suggested_next, releases:[{tag,state,can_rollback}]}`; POST `{version, notes?, confirm}` |
| POST | `/rollback` | `{version, confirm}` → Jenkins `ACTION=rollback` |
| POST | `/sync` | ArgoCD sync (`confirm` on prod) |
| GET/POST/DELETE | `/stress` | status (vus, remaining_sec, started_by, limits) / start `{vus, duration_sec}` / stop |
| GET | `/activity` | |

Also: `POST /presence` (heartbeat), `GET /presence`, `GET /activity`.

**overview.path**: `{ phase, stations[], rails[] }`
- `phase`: building | deploying | rolling_out | scaling | waiting_gate | failed | unhealthy | live | idle
- station `state`: done | active | gate | fail | idle | unknown; jenkins station has `stages[{name,state ok|running|failed|pending,duration_ms}]`, `current_stage`, `image`; cluster station has `instances[{name, look new|old|starting|terminating|stopped|...}]`, `rolling_out`
- rails: done | active | blocked | idle
- downstream of a running build, ArgoCD shows `idle` "Waits for Jenkins" but keeps `sync_status`

Status codes: 409 conflict (running pipeline/stress, tag exists, ArgoCD busy), 428 prod confirm missing, 502 upstream tool error (tool message included), 401/403 auth/role, 415 non-JSON mutation.

---

## 7. Jenkins contract (Mohamed implements)

| Job | Trigger | Params from dashboard | Must do |
|---|---|---|---|
| dev | webhook push `dev` | none | checkout → test → build → SSH → `docker compose up -d` |
| staging | webhook merge `staging` | none | build + push → update `image.tag` in `values-stg.yaml` → git push |
| prod | **dashboard only, no webhook** | `VERSION`, `ACTION` (`release`/`rollback`) | rollback = skip build, only update `values-prod.yaml` |
| k6 | dashboard only | `TARGET_URL`, `VUS`, `DURATION` (`30s`) | must stop cleanly when aborted |

Optional: `currentBuild.description = "image=registry/app:${TAG}"` → Jenkins station shows "pushed <tag>".
API user perms: Overall/Read, Job/Read, Job/Build, Job/Cancel. CSRF crumb handled automatically if required.
Full infra checklist: **REQUIREMENTS.md**.

---

## 8. Auth & security

- `AUTH_MODE=local` (default): users + roles; `off` only for demo/tests (user name from `x-user`, everyone admin).
- Roles: **viewer** (watch), **operator** (pipelines, releases, rollback, sync, stress, tests), **admin** (+ settings, users).
- scrypt passwords (no native deps), session token sha256 in DB, cookie `lf_session` HttpOnly + SameSite=Strict (+Secure with `COOKIE_SECURE=true`), 12h.
- Login throttling: 10 failures per user+IP per 15 min → 429. Unknown users take the same time.
- Mutations must be JSON (415 otherwise). Viewer gets every `can.*` disabled with a reason.
- Tokens AES-256-GCM with `ENCRYPTION_KEY`. CSP via helmet (frames allowed for Grafana; `upgrade-insecure-requests` only when `COOKIE_SECURE`).
- Integration TLS: CA cert or skip-verify per integration/cluster. `tenant_id` → `X-Scope-OrgID` (Loki/Mimir).

Env vars: `ENCRYPTION_KEY` (required), `ADMIN_USERNAME`, `ADMIN_PASSWORD` (first start), `AUTH_MODE`, `SESSION_HOURS`, `COOKIE_SECURE`, `TRUST_PROXY`, `DB_PATH`, `STATIC_DIR`, `CORS_ORIGIN` (`same-origin` in the image), `PORT`.

---

## 9. Frontend (design: "Live flow")

- Top nav (Flow, Runs, Releases, Stress, Settings) + context bar (app select, env tabs, live status pills, "N watching", user menu).
- 3px stripe + hero glow in env color: **dev blue `#6AA6FF`, staging orange `#F5A35C`, prod red `#F27A72`**; green `#46C281`. Dark ground `#0A0D12`, panel `#11151C`, raised `#171C25`, border `#232A36`, text `#E8EBF0`.
- Fonts: IBM Plex Sans + IBM Plex Mono (self-hosted).
- **Flow page**: hero headline from `phase` (lib/headline.js) + delivery path (stations, rails with moving dot, Jenkins stage list, pod squares for rolling updates; vertical on phones) → prod gate panel → stats → signals chart (only metrics the env has, deploy/stress markers) + timeline → logs.
- **Runs**: run list, stages of selected run as a path, live console (follow). **Releases**: versions with states, new release (suggested version), rollback dialog. **Stress**: k6 → Service → Pods → HPA path, sliders within backend limits, stop, CPU chart, HPA events. **Settings**: apps/envs form, clusters/integrations tables with Test, users.
- Polling: overview 3s, events/logs 5s, charts 10s (backend caches 2–5s with in-flight dedup).
- Reduced motion respected; keyboard focus visible.
- Design canvas (mockups): https://claude.ai/artifact/VdKebZ4PFZ8MTVmWYeTJW1

---

## 10. Run, test, deploy

```bash
# demo, no infra (mock tools move on their own; fresh DB every start)
cd backend && npm install && npm run demo                  # API :4000, mocks :4100, auth off
cd backend && AUTH_MODE=local npm run demo                 # admin/demo-admin-123, sara/sara-demo-123 (operator), ahmed/ahmed-demo-123 (viewer)
cd frontend && npm install && npm run dev                  # :5173, proxies /api → :4000

# tests
cd backend && npm test        # 162 checks (smoke, adapters, actions, UI shapes, auth, TLS/CSRF/tenant)
cd frontend && npm test       # 17 tests
python frontend/e2e/flows.py  # browser walkthrough vs. AUTH_MODE=local demo

# real
cp backend/.env.example .env  # ENCRYPTION_KEY, ADMIN_PASSWORD
docker compose up -d --build  # :4000, data in volume /data
```
Then: Settings → Clusters & integrations → add + Test → Apps & environments → add app + envs → Test environment.

---

## 11. Status

**Done (0.5.0):** backend (config, adapters, actions, UI-shaped responses, auth, hardening), frontend (all pages), demo mode, Dockerfile/compose, REQUIREMENTS.md, tests.

**Not verified yet / limitations**
- `Dockerfile` written but **not built** (no Docker in the build sandbox); production mode was tested without a container.
- Only tested against **mock tools** — first run on real Jenkins/ArgoCD/K8s may reveal response differences.
- Single instance only (SQLite, in-memory cache/presence/login throttle).
- Don't expose without HTTPS (operators can sync prod).

**Next steps**
1. Mohamed builds staging infra per REQUIREMENTS.md (cluster-stg + ArgoCD + metrics-server + HPA → Jenkins staging job with Stage View → Prometheus/Loki → dev compose + cAdvisor → prod + k6).
2. First real run → fix differences, update REQUIREMENTS.md + changelog.
3. Deploy the dashboard on AWS (TBD: single container + volume; ECS/EC2 to decide).

---

## 12. Version history

| Version | What |
|---|---|
| 0.1.0 | Backend core: config DB, encryption, settings APIs |
| 0.2.0 | Adapters; dev via cAdvisor (Docker integration removed); connection tests |
| 0.3.0 | Action APIs: release, rollback, sync, builds, stress, activity, cache |
| 0.3.1 | UI-shaped responses: path, gate, can, events timeline, markers, presence |
| 0.4.0 | Frontend Flow page, demo mode |
| 0.5.0 | Runs/Releases/Stress/Settings pages, auth + roles, TLS/tenant/metric-label/CSRF hardening, Docker image |
| 0.5.1–0.5.2 | Settings errors say "Couldn’t save", name the field and mark it (zod + rule errors share `{path, message}`); metric fields trimmed |
| 0.5.4 | Several deployments per environment: workload returns `services[]` + totals (version/image/HPA from the first); Services panel, pods grouped per service, HPA events name the service, PromQL `pod=~"(a|b)-.*"`, connection test checks each |
| 0.5.3 | Renamed Showcase → Liveflow (UI via `frontend/src/lib/brand.js`, docs, packages, image, volume `liveflow-data`, cookie `lf_session`, localStorage `liveflow.user`) |
