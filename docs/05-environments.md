# Environments

> **In short:** an environment tells Liveflow **where** the app runs and **which** job, ArgoCD application and metrics belong to it.

## Fields

| Field | Needed for | Example | Notes |
|---|---|---|---|
| **Runtime** | all | Kubernetes | or Docker Compose |
| **Deploy mode** | Kubernetes | auto | **prod is always manual** (the gate). Not editable for prod |
| **Git branch** | all | `staging` | shown on the GitHub station; prod releases are tagged on this branch |
| **Cluster** | Kubernetes | `cluster-stg` | from Settings → Kubernetes clusters |
| **Namespace** | Kubernetes | `retail-store` | |
| **Deployments** | Kubernetes | `ui, catalog, cart, orders, checkout` | one or more, comma separated, same namespace. **The first is the main service** |
| **Compose project** | Compose | `retail-store` | the `com.docker.compose.project` label |
| **Jenkins / Job** | buttons, Jenkins station | `retail-store-staging` | folders allowed: `team/app-staging` |
| **ArgoCD / Application** | Kubernetes with GitOps | `retail-store-stg` | not allowed for Compose |
| **Prometheus** | metrics | `prom-stg` | **required for Compose** (that is how containers are found) |
| **App selector** | requests / errors | `namespace="retail-store"` | label filter for the request counter |
| **Request metric / Status label** | requests / errors | `http_server_requests_seconds_count` / `status` | defaults: `http_requests_total` / `status` |
| **Loki / Log selector** | logs | `{namespace="retail-store"}` | default: the namespace (k8s) |
| **Grafana / Dashboard UID** | embedded dashboard | `retail-overview` | |
| **k6 job / Target URL** | stress test | `retail-store-k6` / `http://ui.retail-store.svc` | the URL is what k6 attacks |

## Several services in one environment

List every Deployment in **Deployments**. Liveflow then shows:

- a **Services** table: version, pods, HPA and state of each one,
- the pod squares **grouped by service**,
- totals for CPU, memory and pods, and the main service's version and HPA in the headline.

Liveflow counts only each Deployment's **own pods** (`<deployment>-<hash>-<id>`), so a database next to it (for example `catalog-db-0`) is not counted as `catalog`.

## Rules Liveflow checks when you save

- Kubernetes needs a cluster, a namespace and at least one deployment.
- Compose needs a project and a Prometheus integration, and cannot use ArgoCD.
- A Jenkins integration needs a job; a k6 job needs a target URL.
- Names must be valid Kubernetes names (lowercase, digits, `-`).
- **Prod cannot be set to auto-sync.**

Press **Test connections** after saving. Each line names what is wrong.

---

| [← Connect each tool](04-integrations.md) | [Guide home](README.md) | [Using it every day →](06-daily-use.md) |
|:---|:---:|---:|
