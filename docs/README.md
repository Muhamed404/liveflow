# Liveflow guide

Liveflow is **one screen for your whole delivery path**: what Jenkins is building, what ArgoCD will deploy, what is running in each environment, how it behaves, and the button that lets production change.

This guide is for **people who set it up and people who use it**. Read it in order the first time.

| # | Page | Read it when |
|---|---|---|
| 1 | [How Liveflow works](01-how-liveflow-works.md) | you want the idea in 5 minutes |
| 2 | [Install and run](02-install.md) | you are putting Liveflow on a server |
| 3 | [First setup, step by step](03-first-setup.md) | Liveflow is running and empty |
| 4 | [Connect each tool](04-integrations.md) | you need the exact token / permission for GitHub, Jenkins, ArgoCD, Kubernetes, Prometheus, Loki, Grafana |
| 5 | [Environments](05-environments.md) | you fill in dev / staging / prod |
| 6 | [Using it every day](06-daily-use.md) | you deploy, release, roll back, or run a load test |
| 7 | [What your Jenkinsfiles must do](07-jenkins-contract.md) | you write the pipelines Liveflow triggers |
| 8 | [Troubleshooting](08-troubleshooting.md) | a test is red or a station says “Unavailable” |
| 9 | [Full example: retail-store](09-example-retail-store.md) | you want a complete, real configuration to copy |
| — | [API reference](api-reference.md) | you build on the API |

Infrastructure checklist with every requirement in one place: [REQUIREMENTS.md](../REQUIREMENTS.md).
