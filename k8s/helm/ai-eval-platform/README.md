# Helm chart — `ai-eval-platform`

## When to prefer Helm over Kustomize

Both strategies render the **same** underlying resource set for this project.
Kustomize is the **default** manifest strategy (`k8s/base` + `k8s/overlays`);
the Helm chart is the **expansion** path.

| Scenario | Strategy |
|----------|----------|
| Local dev against a Kind cluster | **Kustomize** — `make k8s-setup && make k8s-deploy OVERLAY=dev` |
| GitOps (Argo CD / Flux) with pure git manifests | **Kustomize** — it stays a plain directory of YAML |
| Pinning exact manifests with no templating | **Kustomize** |
| Multiple environments with heavy value overrides | **Helm** — typed `values-*.yaml` + `--set` |
| HA / autoscaling / custom ingress annotations | **Helm** — tunable via values |
| External secrets (SOPS / sealed-secrets / external-secrets) | **Helm** — richer templating for conditionals |
| Package distribution / release lifecycle | **Helm** — semantic versioning in `Chart.yaml` |

Both are committed to `k8s/` and kubeconform-validated in CI/PRs; you never
need to hand-maintain two divergent sets of YAML — the base is the source of
truth and the chart mirrors it.

## Using the chart

```bash
# Dev values (Kind)
helm install ai-eval ./k8s/helm/ai-eval-platform \
  -f k8s/helm/ai-eval-platform/values-dev.yaml

# Production values (override secrets!)
helm install ai-eval ./k8s/helm/ai-eval-platform \
  -f k8s/helm/ai-eval-platform/values-production.yaml \
  --set secrets.jwtSecretKey=... \
  --set secrets.databaseUrl=... \
  --set secrets.postgresPassword=...
```

## Release a new chart version

1. Bump `version` in `Chart.yaml` (semver; `appVersion` tracks the app release).
2. Update `values.yaml` defaults if new settings were added.
3. Run `helm lint .` and `kubeconform` on `helm template` output.