# Liveflow — Infrastructure Requirements

Everything the infrastructure must provide so the dashboard works.
**Living document:** updated whenever the backend needs something new. See the [Changelog](#changelog) at the bottom.

Legend: **[required]** the feature breaks without it · **[optional]** nicer UI if present

---

## 0. Environments at a glance

| Env | Runtime | Deployed by | Trigger | Sync |
|---|---|---|---|---|
| dev | Docker Compose on a dev server | Jenkins (SSH + `docker compose up`) | push to `dev` | — |
| staging | Kubernetes `cluster-stg` | ArgoCD | merge `dev → staging` | auto |
| prod | Kubernetes `cluster-prod` | ArgoCD | dashboard "Create release" | **manual** (dashboard "Sync") |

Repos: `target-app` (code + Jenkinsfiles), `k8s-infra` (Helm chart + `values-stg.yaml` / `values-prod.yaml`), `liveflow` (this dashboard).

---

## 1. Jenkins

### 1.1 Plugins
- [ ] **[required]** Pipeline (workflow-aggregator)
- [ ] **[required]** **Pipeline Stage View** — the dashboard reads stages from `/wfapi/describe`. Without it the Jenkins station shows only the overall status, no stages.
- [ ] **[required]** Git + GitHub plugin (webhook triggers for dev / staging)
- [ ] **[required]** SSH Agent (dev deploy over SSH)
- [ ] **[required]** Credentials Binding (registry login, k8s-infra git push)

### 1.2 API user for the dashboard
- [ ] **[required]** A dedicated user (e.g. `liveflow`) with an **API token** (User → Configure → API Token)
- [ ] **[required]** Permissions: `Overall/Read`, `Job/Read`, `Job/Build`, `Job/Cancel` (Cancel is used to stop stress tests)
- Using an API token means no CSRF crumb is needed.

### 1.3 Jobs (one set per app)
Job names must match what you enter in Settings → environment → `Jenkins job`. Folders are fine (`frontend/staging`).

| Job | Trigger | Parameters the dashboard sends | Must do |
|---|---|---|---|
| **dev** | GitHub webhook on push to `dev` | none (any `UPPER_CASE` params via "Run pipeline") | checkout → test → docker build → SSH → `docker compose up -d` |
| **staging** | GitHub webhook on merge to `staging` | none | checkout → test → build + push image → update `image.tag` in `k8s-infra/values-stg.yaml` → git push |
| **prod** | **no webhook** — dashboard only | `VERSION` (e.g. `v2.2.0`), `ACTION` (`release` \| `rollback`) | `release`: build + push `:VERSION`, update `values-prod.yaml`, git push. `rollback`: **skip the build** (image exists), update `values-prod.yaml` only |
| **k6 stress** | dashboard only | `TARGET_URL`, `VUS`, `DURATION` (e.g. `30s`) | run k6 against `TARGET_URL`; must exit cleanly when aborted |

- [ ] **[required]** Prod job has **no GitHub tag webhook** — the dashboard creates the tag *and* triggers the job; a webhook would run it twice.
- [ ] **[required]** All jobs declare their parameters (`parameters { string(name: 'VERSION') ... }`) so `buildWithParameters` works.
- [ ] **[required]** Jenkins agent has Docker CLI + registry credentials; staging/prod agents have git push access to `k8s-infra`.
- [ ] **[optional]** Set the image on the build so the Jenkins station shows "pushed <tag>" and the gate knows the target version:
  ```groovy
  currentBuild.description = "image=registry.example.com/frontend:${TAG}"
  ```
- Stage names appear **as-is** in the dashboard — keep them short and meaningful (`Checkout`, `Test`, `Build + push`, `Update values-stg.yaml`). Add or remove stages freely; the UI follows the Jenkinsfile.
- One pipeline per environment at a time: the dashboard refuses a second trigger while one runs (`409`).

---

## 2. GitHub

- [ ] **[required]** Personal Access Token with `repo` scope and **push access** to `target-app` (dashboard checks `permissions.push`)
- [ ] **[required]** Branches: `dev`, `staging`, `main`
- [ ] **[required]** Release tags are `vX.Y.Z` on `main`. The dashboard refuses versions not newer than the latest tag.
- [ ] **[required]** Webhooks → Jenkins for **dev and staging jobs only**

---

## 3. ArgoCD

- [ ] **[required]** Local account for the dashboard with `apiKey` capability:
  `argocd account generate-token --account liveflow`
- [ ] **[required]** RBAC for that account: `applications, get` and `applications, sync` on the Liveflow apps
- [ ] **[required]** One Application per env, source = `k8s-infra`, helm `valueFiles: [values-<env>.yaml]`
  - staging: `syncPolicy.automated` (prune + selfHeal)
  - prod: **no** `automated` → manual sync = the production gate
- [ ] **[required]** ArgoCD API reachable from the dashboard backend

---

## 4. Kubernetes (per cluster: stg, prod)

- [ ] **[required]** ServiceAccount + long-lived token for the dashboard (read-only)
- [ ] **[required]** RBAC (Role per namespace or ClusterRole):

  | API group | Resources | Verbs |
  |---|---|---|
  | `""` (core) | `pods`, `events` | `get`, `list` |
  | `apps` | `deployments` | `get`, `list` |
  | `autoscaling` | `horizontalpodautoscalers` (**v2**) | `get`, `list` |

- [ ] **[required]** API server URL reachable from the backend; CA cert pasted in Settings (or `insecure_skip_tls` for a lab)
- [ ] **[required]** Names are DNS-1123 (lowercase, digits, `-`) — namespace and every deployment. An environment can list **several deployments** (e.g. `ui, catalog, cart, orders, checkout`), all in the same namespace; the first is the main one
- [ ] **[required]** HPA uses `scaleTargetRef: { kind: Deployment, name: <deployment> }` and `autoscaling/v2` (one HPA per deployment that should scale; the main deployment's HPA drives the stress page)
- [ ] **[required]** metrics-server installed (HPA needs it)
- Replicas are **never** configured in the dashboard — they are read live from the Deployment and HPA.

---

## 5. Prometheus

- [ ] **[required]** K8s: scrapes kubelet / cAdvisor → `container_cpu_usage_seconds_total`, `container_memory_working_set_bytes` with `namespace`, `pod`, `container` labels
- [ ] **[required]** Dev: **cAdvisor running on the dev server**, scraped by the Prometheus set on the dev env. Needs the Docker Compose labels:
  `container_label_com_docker_compose_project`, `container_label_com_docker_compose_service`, plus `container_last_seen`
- [ ] **[required]** Pods are named the Kubernetes default for Deployments, `<deployment>-<hash>-<id>` — CPU/memory queries match exactly that shape (`pod=~"(<dep1>|<dep2>|...)-[a-z0-9]{1,10}-[a-z0-9]{5}"`), so a same-prefix database pod such as `catalog-db-0` is **not** counted
- [ ] **[optional]** Auth: none, basic (set username + token) or bearer (token only)
- [ ] **[optional]** Multi-tenant (Mimir / Cortex): set **Tenant** on the integration → sent as `X-Scope-OrgID`

---

## 6. Loki

- [ ] **[required]** Promtail (or Alloy) shipping logs with a `namespace` label (k8s)
- [ ] **[required]** Dev: a label to select the compose project — default selector `{compose_project="<project>"}`; set a custom selector in Settings if your labels differ
- [ ] **[optional]** Lines containing `error` / `warn` are coloured by level automatically
- [ ] **[optional]** Multi-tenant Loki: set **Tenant** on the integration → sent as `X-Scope-OrgID`

---

## 7. Grafana

- [ ] **[required]** `allow_embedding = true` (iframe on the dashboard)
- [ ] **[required]** Service account token with **Viewer** role
- [ ] **[required]** Dashboard UID per env (Settings → environment)
- [ ] **[optional]** A `namespace` template variable — the dashboard passes `var-namespace`

---

## 8. Target app

- [ ] **[required]** Exposes a request counter with a status label for the RPS + error-rate panels. Default `http_requests_total{status}`; if your app uses another name (e.g. promhttp `code`, Spring `http_server_requests_seconds_count`), set **Request metric** and **Status label** on the environment
- [ ] **[required]** Container image tags: prod `vX.Y.Z`; staging/dev any unique tag (recommended `stg-<sha7>` / `dev-<sha7>`)
- [ ] **[required]** CPU `requests` set on the container (HPA percentage depends on it)
- [ ] **[optional]** A Kubernetes Service the k6 job can reach (`stress_target_url`)

---

## 9. k8s-infra repo

- [ ] **[required]** Helm chart per app with `values-stg.yaml`, `values-prod.yaml`
- [ ] **[required]** The image tag lives at `image.tag` — the only field Jenkins edits
- [ ] **[required]** HPA template (min/max/target per env) — values come from the values files, not the dashboard

---

## 10. Liveflow backend (this app)

- [ ] **[required]** Internal tools on private / self-signed certificates: paste the **CA certificate** on the integration or cluster (or tick *Skip TLS verification* in a lab)
- [ ] **[required]** `ADMIN_PASSWORD` on the first start (creates the first admin) — or `npm run user:create -- admin admin`
- [ ] **[required]** Served over HTTPS in production → `COOKIE_SECURE=true`; behind a load balancer / ingress → `TRUST_PROXY=1`
- [ ] **[required]** Not exposed to the internet without HTTPS — operators can sync production
- [ ] **[optional]** Grafana on another origin: it must allow being framed by the dashboard origin (`allow_embedding = true`, and no `X-Frame-Options: deny` from a proxy)

- [ ] **[required]** Node.js 20+
- [ ] **[required]** `ENCRYPTION_KEY` = `openssl rand -base64 32` — **never** in git; losing it means re-entering all tokens
- [ ] **[required]** Persistent volume for `DB_PATH` (SQLite)
- [ ] **[required]** Network access from the backend to: Jenkins, GitHub API, ArgoCD, both K8s API servers, Prometheus (dev + stg/prod), Loki, Grafana
- [ ] **[later]** Hosting on AWS — to be decided (phase 5+)

---

## Changelog

| Date | Backend | Change |
|---|---|---|
| 2026-10-20 | 0.1.0 | Initial: clusters, integrations, apps, environments; tokens AES-256-GCM encrypted |
| 2026-10-20 | 0.2.0 | Dev reads containers via **cAdvisor + Prometheus** (Docker integration removed). Adapters for Jenkins, K8s, ArgoCD, GitHub, Prometheus, Loki, Grafana |
| 2026-10-20 | 0.3.0 | Prod job params `VERSION`, `ACTION`; k6 job params `TARGET_URL`, `VUS`, `DURATION`; prod job must have **no** tag webhook; Jenkins user needs `Job/Cancel` |
| 2026-11-21 | 0.5.5 | **No new infra requirements.** Prod environments are always manual sync (auto is rejected). Sync is refused while the env's Jenkins job runs. Rollback is prod-only. Pod / event matching uses the exact Deployment pod shape `<deployment>-<hash>-<id>` (databases with the same prefix are ignored) |
| 2026-11-18 | 0.5.4 | An environment can list **several Kubernetes deployments** (comma separated, same namespace). **No new infra requirements**: same RBAC (`get` on each deployment, `list` pods / HPAs / events). Each deployment needs its own selector labels and `<name>-...` pod names |
| 2026-10-27 | 0.5.3 | Renamed **Showcase → Liveflow**. Suggested Jenkins user and ArgoCD account are now `liveflow` (`argocd account generate-token --account liveflow`); use any name you like. Docker volume is now `liveflow-data` (new empty volume: the first start creates the admin from `ADMIN_PASSWORD` again) |
| 2026-10-25 | 0.5.2 | No new infra requirements. Reminder: a **Docker Compose env needs a Prometheus integration** that scrapes cAdvisor on the dev server. Settings errors now name and mark the field |
| 2026-10-21 | 0.5.0 | Auth (users, roles, sessions): `ADMIN_PASSWORD`, `COOKIE_SECURE`, `TRUST_PROXY`. TLS options (CA / skip verify) on every integration. Tenant (`X-Scope-OrgID`) for Loki / Prometheus. Request metric + status label configurable per env. Jenkins works with or without CSRF crumb. One Docker image serves API + dashboard |
| 2026-10-21 | 0.4.0 | Frontend (Flow page). **No new infra requirements.** Frontend dev server proxies `/api` to the backend on `:4000`. `npm run demo` runs everything on mocks |
| 2026-10-20 | 0.3.1 | **Pipeline Stage View plugin required** (stages from Jenkinsfile). K8s RBAC adds `events`. Optional `currentBuild.description = "image=..."`. Registry station dropped — no registry access needed |
