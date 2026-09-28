{{- /*
ai-eval-platform chart helpers.
SPDX-License-Identifier: Apache-2.0
*/ -}}

{{- define "ai-eval-platform.fullname" -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "ai-eval-platform.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "ai-eval-platform.selectorLabels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- /*
Service names are derived from the single `fullname` helper so the
configmap/secrets defaults and the workload Service manifests can never
drift (this was the `ai-eval-platform-redis` vs `ai-eval-redis` mismatch).
*/ -}}

{{- define "ai-eval-platform.redisServiceName" -}}
{{ include "ai-eval-platform.fullname" . }}-redis
{{- end -}}

{{- define "ai-eval-platform.postgresServiceName" -}}
{{ include "ai-eval-platform.fullname" . }}-postgres
{{- end -}}