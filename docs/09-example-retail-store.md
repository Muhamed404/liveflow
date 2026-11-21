# Full example: retail-store

> **In short:** a real configuration for the [retail-store](https://github.com/Muhamed404/retail-store) project — five services, dev on Docker Compose, staging and prod on Kubernetes with ArgoCD.

## Integrations

| Name | Tool | Base URL | Account |
|---|---|---|---|
| `github` | GitHub | `https://api.github.com` | token for `Muhamed404/retail-store` |
| `jenkins` | Jenkins | `https://jenkins.<domain>` | user `liveflow` + API token |
| `argocd` | ArgoCD | `https://argocd.stg.<domain>` | account `liveflow` |
| `prom-dev` | Prometheus | `http://dev-01:9090` | none |
| `prom-stg` / `prom-prod` | Prometheus | `https://prometheus.<env>.<domain>` | none |
| `loki-stg` / `loki-prod` | Loki | `http://loki.<env>.<domain>:3100` | none |
| `grafana-stg` / `grafana-prod` | Grafana | `https://grafana.<env>.<domain>` | Viewer service account |

Clusters: `cluster-stg`, `cluster-prod` (ServiceAccount `liveflow` in namespace `retail-store`, see [Connect each tool](04-integrations.md#kubernetes-settings--kubernetes-clusters)).

## App

| Field | Value |
|---|---|
| Name | `Retail Store` (id `retail-store`) |
| GitHub | `github` · repository `Muhamed404/retail-store` |

## Environments

| Field | dev | staging | prod |
|---|---|---|---|
| Runtime | Docker Compose | Kubernetes | Kubernetes |
| Git branch | `dev` | `staging` | `main` |
| Cluster / Namespace | — | `cluster-stg` / `retail-store` | `cluster-prod` / `retail-store` |
| Compose project | `retail-store` | — | — |
| Deployments | — | `ui, catalog, cart, orders, checkout` | same |
| Jenkins job | `retail-store-dev` | `retail-store-staging` | `retail-store-prod` |
| ArgoCD application | — | `retail-store-stg` (auto) | `retail-store-prod` (manual) |
| Prometheus | `prom-dev` | `prom-stg` | `prom-prod` |
| App selector | `container_label_com_docker_compose_project="retail-store"` | `namespace="retail-store"` | `namespace="retail-store"` |
| Request metric / Status label | `http_server_requests_seconds_count` / `status` | same | same |
| Loki | — | `loki-stg` | `loki-prod` |
| k6 job / Target URL | — | `retail-store-k6` / `http://ui.retail-store.svc` | — |

`ui` comes first, so its version and HPA are shown in the headline. Its request counter is the Spring Boot one, hence the request metric above.

## Check it

1. **Test connections** on each environment: every line green.
2. Merge to `staging`: Jenkins → ArgoCD → Cluster move, the Services table shows the five services.
3. Create release `v1.0.0` on prod: the gate appears; Sync it.

---

| [← Troubleshooting](08-troubleshooting.md) | [Guide home](README.md) | [Guide home →](README.md) |
|:---|:---:|---:|
