{{/*
Chart name.
*/}}
{{- define "portalai.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Fully qualified app name. Truncated to 63 chars for the DNS-label limit.
*/}}
{{- define "portalai.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Common labels applied to every object.
*/}}
{{- define "portalai.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ include "portalai.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/*
Selector labels for a component (api | web). Call with a dict:
  (dict "root" . "component" "api")
*/}}
{{- define "portalai.selectorLabels" -}}
app.kubernetes.io/name: {{ include "portalai.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/*
Name of the Secret the app reads env from — the operator-supplied existingSecret
if set, else the chart-managed Secret.
*/}}
{{- define "portalai.secretName" -}}
{{- if .Values.existingSecret -}}
{{- .Values.existingSecret -}}
{{- else -}}
{{- printf "%s-secret" (include "portalai.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/*
DATABASE_URL. Skeleton composes it from postgresql.external; the bundled-service
branch is added in slice 4.
*/}}
{{- define "portalai.databaseUrl" -}}
{{- with .Values.postgresql.external -}}
postgresql://{{ .user }}:{{ .password }}@{{ .host }}:{{ .port }}/{{ .database }}
{{- end -}}
{{- end -}}

{{/*
REDIS_URL. Skeleton uses redis.external.url; the bundled-service branch is added
in slice 4.
*/}}
{{- define "portalai.redisUrl" -}}
{{- .Values.redis.external.url -}}
{{- end -}}
