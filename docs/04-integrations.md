# Connect each tool

> **In short:** for each tool create a **dedicated account with the smallest permissions**, put its URL and token in Liveflow, press **Test**.

Every integration has the same fields:

| Field | Meaning |
|---|---|
| **Name** / id | how you will pick it in an environment |
| **Base URL** | the tool's address as the **Liveflow server** reaches it |
| **Username** | only where noted below |
| **Token** | stored encrypted; leave empty when editing to keep the old one |
| **CA certificate (optional)** | paste your internal CA if the tool uses a private certificate |
| **Skip TLS verification** | labs only |
| **Tenant (optional)** | Loki / Prometheus multi-tenant setups: sent as `X-Scope-OrgID` |

---

## GitHub

**Used for:** release tags on prod, the Releases list. **Base URL:** `https://api.github.com` (GitHub Enterprise: `https://<host>/api/v3`).

1. Create a token (fine-grained) for the app repository with **Contents: read and write** (needed to create tags and releases).
2. Integrations → *GitHub* → paste the token → **Test** → `authenticated as <user>`.
3. On the **app**, pick this integration and set the repository as `owner/repo`.

The environment test then shows `repo owner/repo (default branch: main)`.

---

## Jenkins

**Used for:** the Jenkins station, stages, logs, *Run pipeline*, releases, rollbacks, the k6 stress test.
**Base URL:** `https://jenkins.example.com` · **Username:** the Jenkins user · **Token:** that user's **API token**.

1. Create a user `liveflow`. Permissions: **Overall/Read, Job/Read, Job/Build, Job/Cancel** (Cancel stops stress tests).
2. User → Configure → **API Token** → Generate.
3. Install the **Pipeline Stage View** plugin, otherwise Liveflow cannot show stages.
4. Test → `authenticated as liveflow`.

Your jobs must accept the parameters Liveflow sends: [What your Jenkinsfiles must do](07-jenkins-contract.md).

---

## ArgoCD

**Used for:** the ArgoCD station and the **gate** (Sync). **Base URL:** `https://argocd.example.com` · **Token:** an account token.

1. Add a local account in `argocd-cm`: `accounts.liveflow: apiKey`
2. Give it access in `argocd-rbac-cm`:
   ```
   p, role:liveflow, applications, get,  */*, allow
   p, role:liveflow, applications, sync, */*, allow
   g, liveflow, role:liveflow
   ```
3. `argocd account generate-token --account liveflow` → paste it → **Test**.
4. One ArgoCD application per environment. **Staging:** auto-sync. **Prod:** **no** auto-sync — that is what makes the gate.

---

## Kubernetes (Settings → Kubernetes clusters)

**Used for:** pods, versions, rolling updates, HPA and events. Read-only.
**API server URL:** e.g. `https://10.0.0.10:6443` · **Token:** a ServiceAccount token · **CA certificate:** the cluster CA.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata: { name: liveflow, namespace: retail-store }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: { name: liveflow-read, namespace: retail-store }
rules:
  - { apiGroups: [""], resources: [pods, events], verbs: [get, list] }
  - { apiGroups: [apps], resources: [deployments], verbs: [get, list] }
  - { apiGroups: [autoscaling], resources: [horizontalpodautoscalers], verbs: [get, list] }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: { name: liveflow-read, namespace: retail-store }
subjects: [{ kind: ServiceAccount, name: liveflow, namespace: retail-store }]
roleRef: { kind: Role, name: liveflow-read, apiGroup: rbac.authorization.k8s.io }
---
apiVersion: v1
kind: Secret
metadata: { name: liveflow-token, namespace: retail-store, annotations: { kubernetes.io/service-account.name: liveflow } }
type: kubernetes.io/service-account-token
```

```bash
kubectl -n retail-store get secret liveflow-token -o jsonpath='{.data.token}' | base64 -d   # the token
kubectl -n retail-store get secret liveflow-token -o jsonpath='{.data.ca\.crt}' | base64 -d  # the CA
```

Test → `connected — Kubernetes v1.30.x`. Also needed in the cluster: **metrics-server** (for the HPA).

---

## Prometheus

**Used for:** CPU, memory, requests per second, error rate, the charts. On **dev** also the list of containers.
**Base URL:** `http://prometheus.example.com:9090` · **Token:** none, a bearer token, or username + password (basic auth).

- **Kubernetes environments:** Prometheus must scrape the kubelet / cAdvisor (`container_cpu_usage_seconds_total`, `container_memory_working_set_bytes`). kube-prometheus-stack does this.
- **Docker Compose (dev):** run **cAdvisor** on the dev server and scrape it. Liveflow finds containers by the label `com.docker.compose.project`.
- **Requests and errors** come from your app's request counter. Default `http_requests_total` with a `status` label; set **Request metric** and **Status label** on the environment if yours differ (Spring Boot: `http_server_requests_seconds_count` + `status`).

Test → `connected — Prometheus <version>`.

---

## Loki

**Used for:** the Logs panel. **Base URL:** `http://loki.example.com:3100`.
Promtail (or Alloy) must label streams with `namespace` (Kubernetes). For Compose set a **Log selector** on the environment if your labels differ from `{compose_project="<project>"}`.

---

## Grafana

**Used for:** the embedded dashboard. **Base URL:** `https://grafana.example.com` · **Token:** a service account token with the **Viewer** role.
In `grafana.ini` set `allow_embedding = true`. Put the dashboard's **UID** on each environment. If the dashboard has a `namespace` variable, Liveflow fills it.

---

| [← First setup, step by step](03-first-setup.md) | [Guide home](README.md) | [Environments →](05-environments.md) |
|:---|:---:|---:|
