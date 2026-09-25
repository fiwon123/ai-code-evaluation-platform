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
| TLS termination / cert-manager issued certificates | **Helm** — `ingress.tls` + `ingress.annotations` |
| External secrets (SOPS / sealed-secrets / external-secrets) | **Helm** — richer templating for conditionals |
| Managed PostgreSQL (bring your own DB) | **Helm** — `postgres.enabled=false` + `secrets.databaseUrl` |
| Package distribution / release lifecycle | **Helm** — semantic versioning in `Chart.yaml` |

Both are committed to `k8s/` and validated locally with `kustomize build` +
`helm template` (kubeconform in CI/PRs); you never need to hand-maintain two
divergent sets of YAML — the base is the source of truth and the chart
mirrors it.

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

## Secrets

The chart renders a `Secret` from `values.secrets.*` (dev defaults only —
production MUST override via `--set secrets.*` or external-secrets). The env
names match the backend's expectations **and** the kustomize base
(`k8s/base/secrets.yaml`) — one source of truth, no drift.

| Secret key | Backend env var | Notes |
|------------|-----------------|-------|
| `secrets.jwtSecretKey` | `JWT_SECRET_KEY` | Required; backend refuses to boot in production with the dev default |
| `secrets.databaseUrl` | `DATABASE_URL` | Blank → falls back to the in-chart postgres Service (helper-derived) |
| `secrets.postgresPassword` | `POSTGRES_PASSWORD` | Also provisions the bundled postgres StatefulSet |
| `secrets.openaiApiKey` | `OPENAI_API_KEY` | LLM provider key |
| `secrets.anthropicApiKey` | `ANTHROPIC_API_KEY` | LLM provider key |
| `secrets.geminiApiKey` | `GEMINI_API_KEY` | LLM provider key (Gemini) |
| `secrets.githubClientId` | `GITHUB_CLIENT_ID` | GitHub OAuth2 — feature is inert when empty |
| `secrets.githubClientSecret` | `GITHUB_CLIENT_SECRET` | GitHub OAuth2 — feature is inert when empty |

Ollama needs **no** secret: it is keyless by design (local service, see
`backend/src/app/services/llm_providers/ollama_provider.py`).

## Configuration highlights

- **`config.redisUrl`** — blank by default; the ConfigMap falls back to the
  in-chart redis Service name via the `redisServiceName` helper (the old
  hard-coded `ai-eval-platform-redis` is gone). Set explicitly to use a
  managed/external Redis.
- **`postgres.enabled`** — set `false` and provide `secrets.databaseUrl` to
  use a managed PostgreSQL. The chart fails at render time if you disable
  postgres without an external URL.
- **`autoscaling.worker.enabled`** — renders a second HPA for the Celery
  worker (backed by the global `autoscaling.enabled` switch). Disabled by
  default.
- **`ingress.tls`** — a list of `{hosts, secretName}` entries rendered as
  `spec.tls`. Pair with cert-manager via `ingress.annotations`, e.g.:
  `cert-manager.io/cluster-issuer: letsencrypt-prod`.
- **`serviceAccount.create`** — creates a dedicated ServiceAccount
  (named `fullname`, or `serviceAccount.name`) and attaches it to backend,
  worker, beat, and frontend. Useful with Role/RoleBinding scoping.

## Release a new chart version

1. Bump `version` in `Chart.yaml` (semver; `appVersion` tracks the app release).
2. Update `values.yaml` defaults if new settings were added.
3. Run `helm lint .`, `helm template` for each `values-*.yaml`, and
   `kubeconform` on the rendered output.