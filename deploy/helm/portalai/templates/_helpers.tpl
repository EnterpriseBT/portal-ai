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
DATABASE_URL. Composed from the bundled postgresql service when enabled, else
from postgresql.external.
*/}}
{{- define "portalai.databaseUrl" -}}
{{- if .Values.postgresql.enabled -}}
{{- with .Values.postgresql.auth -}}
postgresql://{{ .username }}:{{ .password }}@{{ $.Release.Name }}-postgresql:5432/{{ .database }}
{{- end -}}
{{- else -}}
{{- with .Values.postgresql.external -}}
postgresql://{{ .user }}:{{ .password }}@{{ .host }}:{{ .port }}/{{ .database }}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
REDIS_URL. Composed from the bundled redis master service when enabled (auth
off — evaluation-grade), else from redis.external.url.
*/}}
{{- define "portalai.redisUrl" -}}
{{- if .Values.redis.enabled -}}
redis://{{ .Release.Name }}-redis-master:6379
{{- else -}}
{{- .Values.redis.external.url -}}
{{- end -}}
{{- end -}}

{{/*
UPLOAD_S3_ENDPOINT. Bundled MinIO service when enabled, else minio.external.endpoint.
*/}}
{{- define "portalai.s3Endpoint" -}}
{{- if .Values.minio.enabled -}}
http://{{ .Release.Name }}-minio:9000
{{- else -}}
{{- .Values.minio.external.endpoint -}}
{{- end -}}
{{- end -}}

{{/*
UPLOAD_S3_BUCKET. Bundled default bucket when enabled, else minio.external.bucket.
*/}}
{{- define "portalai.s3Bucket" -}}
{{- if .Values.minio.enabled -}}
{{- .Values.minio.defaultBuckets -}}
{{- else -}}
{{- .Values.minio.external.bucket -}}
{{- end -}}
{{- end -}}

{{/*
#660: env for the migration jobs only (migrate + upgrade), never the API pods.
MIGRATE_DATABASE_URL is a user able to CREATE ROLE, used only to provision the
restricted SQL reader role (migration 0118's DDL) and grant it to the app user;
the schema migrations themselves still run as DATABASE_URL, so the app user
owns every table. Bundled DB: the subchart's `postgres` superuser. External DB:
postgresql.external.migrationUser, when set; otherwise nothing is emitted and
the app user provisions the role itself (it then needs CREATEROLE). The password is passed separately as
MIGRATE_DATABASE_PASSWORD, never in the URL, so it needs no URL-encoding.
*/}}
{{- define "portalai.migrationEnv" -}}
{{- if .Values.postgresql.enabled }}
- name: MIGRATE_DATABASE_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ printf "%s-postgresql" .Release.Name }}
      key: postgres-password
- name: MIGRATE_DATABASE_URL
  value: {{ printf "postgresql://postgres@%s-postgresql:5432/%s" .Release.Name .Values.postgresql.auth.database | quote }}
{{- else if .Values.postgresql.external.migrationUser }}
{{- $ext := .Values.postgresql.external }}
- name: MIGRATE_DATABASE_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ $ext.migrationExistingSecret.name | default (printf "%s-migrate" (include "portalai.fullname" .)) }}
      key: {{ $ext.migrationExistingSecret.key | default "password" }}
- name: MIGRATE_DATABASE_URL
  value: {{ printf "postgresql://%s@%s:%v/%s" ($ext.migrationUser | urlquery) $ext.host $ext.port $ext.database | quote }}
{{- end }}
{{- end -}}
