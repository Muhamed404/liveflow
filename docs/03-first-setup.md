# First setup, step by step

> **In short:** add the **tools** first, then the **app**, then its **environments**, and press **Test** after each step.

All of this is in **Settings** (admin only).

## Order

| Step | Where | What |
|---|---|---|
| 1 | Settings → **Kubernetes clusters** | one entry per cluster (e.g. `cluster-stg`, `cluster-prod`) |
| 2 | Settings → **Integrations** | one entry per tool: Jenkins, ArgoCD, GitHub, Prometheus (one per Prometheus), Loki, Grafana |
| 3 | Press **Test** on each | each one must say *connected* / *authenticated as …* |
| 4 | Settings → **Apps** → *New app* | the product name, the GitHub integration and the repository (`owner/repo`) |
| 5 | The app → **Environment** `dev`, `staging`, `prod` | runtime, cluster, namespace, deployments, Jenkins job, ArgoCD application, Prometheus, Loki, Grafana |
| 6 | Press **Test connections** on each environment | checks the exact job, deployments, ArgoCD app, metrics and logs of that environment |
| 7 | Open the **Flow** page | the delivery path should be green |

## What each step needs

The exact token, permission and URL for every tool are on the next page: [Connect each tool](04-integrations.md).
The fields of an environment are explained in [Environments](05-environments.md).

## Tips

- **Name things the way your team says them.** The app's *Name* is what people see at the top left; its id is used in links.
- **Start with staging.** It has the most stations. When staging is green, prod is a copy with another namespace, ArgoCD application and Jenkins job.
- **One Prometheus per place.** The dev server's Prometheus (cAdvisor) and the cluster's Prometheus are two different integrations.
- **Test is safe.** Connection tests only read.

---

| [← Install and run](02-install.md) | [Guide home](README.md) | [Connect each tool →](04-integrations.md) |
|:---|:---:|---:|
