# What your Jenkinsfiles must do

> **In short:** Liveflow starts your jobs with a few parameters and reads their stages. Your Jenkinsfiles do the real work.

## Jobs and parameters

| Job | Started by | Parameters Liveflow sends | The job must |
|---|---|---|---|
| **dev** | git push (webhook), or *Run pipeline* | none | build, test, deploy to the dev server |
| **staging** | git merge (webhook), or *Run pipeline* | none | build, push the image, write the new tag into the staging values file in git |
| **prod** | **Liveflow only** | `VERSION` (`v2.3.0`), `ACTION` (`release` or `rollback`) | `release`: make the image `:VERSION` available and write it into the prod values file. `rollback`: **no build**, only write `VERSION` into the values file |
| **k6** | Liveflow only | `TARGET_URL`, `VUS`, `DURATION` (`30s`) | run k6; stop cleanly when aborted |

```groovy
// prod job
parameters {
  string(name: 'VERSION', description: 'vX.Y.Z')
  choice(name: 'ACTION', choices: ['release', 'rollback'])
}
```

## Rules

- The **prod job has no webhook.** Liveflow creates the tag *and* starts the job; a webhook would run it twice.
- Every job **declares its parameters**, otherwise `buildWithParameters` fails.
- **Stage names are shown as they are.** Keep them short: `Checkout`, `Build`, `Scan`, `Push`, `Update values`.
- Optional, but recommended: tell Liveflow which image you built, so the Jenkins station says “pushed …” and the gate knows the version:
  ```groovy
  currentBuild.description = "image=harbor.example.com/retail-store/ui:${VERSION}"
  ```

## The version Liveflow shows

Liveflow reads the running version from the **image tag** of the main service. On prod it marks a release **Live** when that tag equals the GitHub tag (`v2.3.0`).

> [!IMPORTANT]
> If your images are tagged with the git sha (build once, promote the same image), let the prod job **re-tag the same image** as `vX.Y.Z` in the registry (for example with `crane tag` or `skopeo copy`) and write `vX.Y.Z` into the prod values file. Nothing is rebuilt, and Liveflow can match the release.

---

| [← Using it every day](06-daily-use.md) | [Guide home](README.md) | [Troubleshooting →](08-troubleshooting.md) |
|:---|:---:|---:|
