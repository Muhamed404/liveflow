# API reference

> For people who build on Liveflow. Users and admins: start with the [guide](README.md).

All routes are under `/api`. Signed-in requests use the `lf_session` cookie; writes must be JSON.
Environment routes live under `/api/apps/:appId/environments/:env` (`env` = `dev` | `staging` | `prod`).

## Rules the API enforces

| Rule | Response |
|---|---|
| Prod release / rollback / sync / stress without `"confirm": true` | `428` |
| A second pipeline or stress test while one runs | `409` |
| Sync while that environment's Jenkins job is still running | `409` (`wait for #N`) |
| Rollback on dev / staging | `400` (rollback is prod only) |
| Versioned release outside prod, or not newer than the latest tag | `400` |
| Prod environment saved with `deploy_mode: auto` | `400` |
| Action by a viewer / settings change by a non-admin | `403` |

---

## Phase 4a — Frontend: Flow page (done)

`frontend/` — Vite + React 18 + React Query, IBM Plex Sans / Mono (self-hosted via @fontsource).

- **Delivery path** drawn straight from `overview.path`: stations, rails, Jenkins stages from your Jenkinsfile, pod squares for rolling updates. Vertical on phones.
- **Prod gate**: type the env name, then **Sync** (`POST /sync` with `confirm: true`).
- **Run pipeline** on dev / staging, disabled with the backend's reason while a run is going.
- Stats, signals chart with deploy / stress markers (only metrics the env really has), "What just happened" timeline, Loki logs with filter + level.
- Name prompt on first visit (sent as `x-user` until auth), "N watching" from presence.
- Polling: overview 3s, timeline/logs 5s, charts 10s — the backend cache keeps this cheap.

```bash
cd frontend && npm test        # 13 UI tests against fixtures captured from the real API
```

## Phase 1 — Backend core (done)

```bash
cd backend
cp .env.example .env
# put a key in ENCRYPTION_KEY:  openssl rand -base64 32
npm install
npm test        # smoke + adapter tests (uses mock tools, no real infra needed)
npm run dev     # http://localhost:4000/api/health
```

### Data model
| Table          | What it holds |
|----------------|---------------|
| `clusters`     | K8s API URL + ServiceAccount token (encrypted) |
| `integrations` | Shared tools: jenkins, github, argocd, prometheus, grafana, loki, docker |
| `apps`         | App + its GitHub repo |
| `environments` | One row per app+env: runtime (compose/k8s), cluster, namespace, jenkins job, argocd app, selectors |

Replicas are **not** stored — they're read live from the cluster / HPA.
Tokens are AES-256-GCM encrypted and never returned by the API (`has_token: true` only).

### API
```
GET|POST        /api/clusters            GET|PUT|DELETE /api/clusters/:id
GET|POST        /api/integrations?type=  GET|PUT|DELETE /api/integrations/:id
GET|POST        /api/apps                GET|PUT|DELETE /api/apps/:appId
GET             /api/apps/:appId/environments
GET|PUT|DELETE  /api/apps/:appId/environments/:env   (PUT = create or update)
```

### Example
```bash
curl -X POST localhost:4000/api/clusters -H 'content-type: application/json' \
  -d '{"id":"cluster-stg","name":"Staging","api_url":"https://k8s-stg:6443","token":"<SA token>"}'

curl -X POST localhost:4000/api/integrations -H 'content-type: application/json' \
  -d '{"id":"jenkins-main","type":"jenkins","name":"Jenkins","base_url":"http://jenkins:8080","username":"admin","token":"<api token>"}'

curl -X POST localhost:4000/api/apps -H 'content-type: application/json' \
  -d '{"id":"frontend-app","name":"Frontend"}'

curl -X PUT localhost:4000/api/apps/frontend-app/environments/staging -H 'content-type: application/json' \
  -d '{"runtime":"k8s","cluster_id":"cluster-stg","namespace":"frontend-stg","deployment":"frontend",
       "jenkins_integration_id":"jenkins-main","jenkins_job":"frontend-stg"}'
```

## Phase 2 — Adapters (done)

`src/adapters/` — one file per tool, all built on `http.js` (timeouts, TLS/CA for k8s, clean errors).

| Adapter      | Main functions |
|--------------|----------------|
| `jenkins`    | triggerBuild, resolveQueue, getBuild (+stages via Pipeline Stage View), listBuilds, getLog |
| `k8s`        | getDeployment (live replicas), listPods, getHpa |
| `argocd`     | getApp (sync/health/history), sync (manual prod deploy) |
| `github`     | listReleases, tagExists, createRelease |
| `prometheus` | query, scalar, range — PromQL built in `queries.js` |
| `loki`       | recent (newest first, level detection) |
| `grafana`    | testDashboard, embedUrl |

### Connection tests (Settings → "Test connections")
```
POST /api/clusters/:id/test
POST /api/integrations/:id/test
POST /api/apps/:appId/environments/:env/test   # checks the exact job / deployment / argocd app / metrics
```

### Dev env = Docker Compose + cAdvisor
The dashboard never talks to Docker. Dev containers are read from Prometheus:
`container_last_seen{container_label_com_docker_compose_project="<compose_project>"}`.
Requirements on the dev server: cAdvisor running, scraped by the Prometheus set in `prometheus_integration_id`.

### Target app requirements
- Expose `http_requests_total` (with a `status` label) for RPS / error-rate panels.
- K8s CPU/memory come from kubelet cAdvisor — no app changes needed.
- Grafana: `allow_embedding = true` for the iframe.

## Phase 3 — Action APIs (done)

All under `/api/apps/:appId/environments/:env`

| Method | Path | What it does |
|--------|------|--------------|
| GET  | `/overview` | workload + metrics + last pipeline + ArgoCD in one call. Each section is `{data}` or `{error}` |
| GET  | `/workload` | pods (k8s) or containers (compose via cAdvisor), live replicas, HPA |
| GET  | `/metrics` | cpu_cores, memory_bytes, rps, error_rate |
| GET  | `/metrics/:metric?minutes=15` | time series for charts |
| GET  | `/logs?limit=&minutes=&contains=` | Loki, newest first |
| GET/POST | `/builds` | list / trigger dev & staging pipeline |
| GET  | `/builds/:n`, `/builds/:n/log?start=` | stages + progressive console log |
| GET  | `/queue/:id` | queue item → build number |
| GET/POST | `/releases` | **prod only**: GitHub tag + Jenkins `VERSION`, `ACTION=release` |
| POST | `/rollback` | redeploy existing tag: Jenkins `VERSION`, `ACTION=rollback` |
| POST | `/sync` | ArgoCD sync — the manual prod gate |
| GET/POST/DELETE | `/stress` | status / start / stop the k6 job |
| GET  | `/activity` | who did what on this env (also `GET /api/activity` for all) |

### Safety rules
- **Prod** release / rollback / sync / stress need `"confirm": true` → otherwise `428`.
- Only **one pipeline** and **one stress test** at a time per env → `409` for the second interviewer.
- Release version must be `vX.Y.Z`, **newer than the latest tag**, and not already exist.
- The running-pipeline check happens **before** tagging, so a blocked release never leaves a stray tag.
- Every action is written to `activity` (ok / failed + actor from `x-user` header until auth lands).
- Reads are cached 2–5s with in-flight de-dup: 5 interviewers polling = 1 call to the cluster.

### Jenkins contract (your Jenkinsfiles must accept these)
| Job | Parameters sent by the dashboard |
|-----|-----|
| prod job (`jenkins_job` of prod) | `VERSION` (e.g. `v2.2.0`), `ACTION` (`release` \| `rollback` — skip the image build on rollback) |
| dev / staging job | none by default (any `UPPER_CASE` params passed through `POST /builds`) |
| k6 job (`stress_job`) | `TARGET_URL`, `VUS`, `DURATION` (e.g. `30s`) |

Prod Jenkins job should **not** have a GitHub tag webhook — the dashboard triggers it, otherwise it runs twice.

## Phase 3.1 — Shaped for the "Live flow" UI (done)

The backend now computes what the screens draw, so the React side only renders.

### `GET /overview` additions
```jsonc
{
  "path": {
    "phase": "building | deploying | rolling_out | scaling | waiting_gate | failed | unhealthy | live | idle",
    "stations": [
      { "id": "github",  "state": "done", "status": "Changes picked up", "detail": "d41e0a7 → staging", "trigger": { "user": "Mohamed" } },
      { "id": "jenkins", "state": "active", "status": "#49 running", "detail": "Build + push",
        "stages": [{ "name": "Checkout", "state": "ok", "duration_ms": 10000 }, { "name": "Build + push", "state": "running" }],
        "current_stage": "Build + push", "image": "registry/frontend:stg-d41e0a7", "duration_ms": 151000 },
      { "id": "argocd",  "state": "idle", "status": "Waits for Jenkins", "sync_status": "Synced" },
      { "id": "cluster", "state": "active", "status": "Rolling out 2 / 3", "rolling_out": true,
        "instances": [{ "name": "frontend-58cd-a", "look": "new | old | starting | terminating | stopped" }] }
    ],
    "rails": ["active", "idle", "idle"]          // done | active | blocked | idle — one per gap
  },
  "gate": { "waiting": true, "from_version": "v2.1.0", "to_version": "v2.2.0", "target": "cluster-prod/frontend-prod", "pods": 5, "requires_confirm": true },
  "can": { "run_pipeline": { "allowed": false, "reason": "#49 is running — one pipeline per environment" }, "release": {}, "sync": {}, "stress": {} },
  "stress": { "data": { "running": true, "vus": 50, "duration_sec": 120, "remaining_sec": 72, "started_by": "sara", "limits": {} } }
}
```
- Stations: k8s = `github → jenkins → argocd → cluster`, compose = `github → jenkins → dev_server`. Every one is backed by a real API — no inferred stations.
- **Jenkins stages come from your Jenkinsfile** (`wfapi/describe`, needs the *Pipeline Stage View* plugin), normalized to `ok | running | failed | pending`.
- Station `state`: `done | active | gate | fail | idle | unknown`. A station downstream of a running build is `idle` ("Waits for Jenkins") but keeps its real status in `sync_status`.
- Pods: `current` = runs the deployment's desired image → `look: new | old` for the rolling-update squares.

### New / changed endpoints
| Method | Path | For |
|---|---|---|
| GET  | `/events?limit=40` | "What just happened": user actions + Jenkins runs + ArgoCD history + k8s & HPA events, newest first. A failing source lands in `sources_failed`, not an error |
| GET  | `/metrics/:metric` | now also returns `markers` (deploys, stress starts) inside the window |
| GET  | `/releases` | **shape changed** → `{ live_version, pending_version, latest_tag, suggested_next, releases: [{ tag, state: live\|waiting\|building\|previous, can_rollback }] }` |
| GET  | `/stress` | adds `vus, duration_sec, elapsed_sec, remaining_sec, started_by, target_url, limits` |
| POST | `/api/presence` | heartbeat `{ app, env, page }` (user from `x-user`), returns who's watching — 30s TTL |
| GET  | `/api/presence?app=&env=` | "3 watching" |

### Jenkins contract (optional addition)
Set `currentBuild.description = "image=registry/frontend:${TAG}"` in the Jenkinsfile → the Jenkins station shows "pushed <tag>" and the gate knows the target version on non-prod envs.

## Phase 4b / 4c / 5 — Pages, settings, auth (done)
- **Runs**: run list, stages of the selected run drawn as a path, live Jenkins console (progressive, follow toggle).
- **Releases** (prod): versions with live / waiting / building / previous, new release with suggested version, rollback; prod actions need the env name typed.
- **Stress**: k6 → Service → Pods → HPA path, sliders inside the backend limits, stop button, CPU chart with stress markers, HPA events.
- **Settings**: apps and their environments (runtime, cluster, Jenkins job, ArgoCD app, selectors, k6), clusters and integrations with **Test** per row, users.
- **Auth**: users + roles, scrypt passwords, HttpOnly SameSite=Strict session cookie, sign-in throttling, JSON-only mutations.
- **Integration hardening**: TLS options (CA / skip verify) on every tool, Jenkins CSRF crumb fallback, `X-Scope-OrgID` tenant for Loki / Mimir, configurable request metric + status label, tool error messages shown as-is.

---

[← Guide home](README.md)
