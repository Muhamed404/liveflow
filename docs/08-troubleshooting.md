# Troubleshooting

> **In short:** press **Test connections** on the environment first. Each line names the tool and what failed.

| You see | Likely cause | Fix |
|---|---|---|
| `authentication failed` | wrong or expired token | create a new token, paste it, Test again |
| `certificate` / `self-signed` errors | private CA | paste the CA in **CA certificate**, or tick *Skip TLS verification* in a lab |
| `ECONNREFUSED` / timeout | the Liveflow **server** cannot reach the tool | check the URL from the server: `curl <url>` |
| `deployment … not found` | wrong namespace or name in **Deployments** | `kubectl -n <ns> get deploy` |
| `no CPU series found for this workload` | Prometheus does not scrape cAdvisor, or pods are not named `<deployment>-…` | check the Prometheus targets |
| `no cAdvisor series for compose project` | cAdvisor missing on the dev server, or another project name | run cAdvisor, check `com.docker.compose.project` |
| Jenkins station shows no stages | Pipeline Stage View plugin missing | install it |
| Requests / errors show `—` | request metric or label name differs | set **Request metric** / **Status label** on the environment |
| Logs empty | selector does not match | set **Log selector** |
| Grafana panel blank | embedding off | `allow_embedding = true`, no `X-Frame-Options: deny` in a proxy |
| `pipeline #N is already running` | one run per environment | wait, or stop it in Jenkins |
| `wait for #N: Jenkins is still running` | Sync while the job may still write the tag | wait for the job to finish |
| `production action requires "confirm"` | API call without confirmation | type `prod` in the dialog (API: `"confirm": true`) |
| `prod is always manual` | trying to set prod to auto | expected; prod always uses the gate |
| `Needs the operator role` | you are a viewer | ask an admin for the operator role |
| Can't sign in after a restart | sessions expired, or `COOKIE_SECURE=true` without HTTPS | sign in again; match `COOKIE_SECURE` to how you serve Liveflow |

Still stuck? `docker compose logs liveflow` shows every failed call with the tool's own message.

---

| [← What your Jenkinsfiles must do](07-jenkins-contract.md) | [Guide home](README.md) | [Full example: retail-store →](09-example-retail-store.md) |
|:---|:---:|---:|
