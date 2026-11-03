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
A bundled dep's object name (StatefulSet, Service, Secret): <fullname>-<dep>.
Call with a dict: (dict "root" . "dep" "postgresql")
*/}}
{{- define "portalai.depName" -}}
{{- printf "%s-%s" (include "portalai.fullname" .root) .dep | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
A credential the chart generates once and keeps (#946): the explicit value
when one is set, else the value already in the release's Secret, else a new
random one. Render it in exactly ONE Secret and reference that key everywhere
else, since each call outside an existing Secret draws a fresh value.
Call with a dict: (dict "root" . "secret" <name> "key" <key> "value" <explicit>)
*/}}
{{- define "portalai.keptSecretValue" -}}
{{- if .value -}}
{{- .value -}}
{{- else -}}
{{- $existing := lookup "v1" "Secret" .root.Release.Namespace .secret -}}
{{- if and $existing $existing.data (hasKey $existing.data .key) -}}
{{- index $existing.data .key | b64dec -}}
{{- else -}}
{{- randAlphaNum 32 -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
The install's system principal, SYSTEM_ID (#953): the explicit
`config.SYSTEM_ID`, else the value already in the release's config ConfigMap,
else the hooks' copy (left by a failed first install), else "SYSTEM".
Migrations read it as `portalai.system_id` (#952), so any value works, but it
is write-once: every platform row carries it, and a change strands them. So an
explicit value that differs from the install's existing one fails the render,
and a blank or whitespace-padded one is refused. The value is handled as a
string throughout, so `--set config.SYSTEM_ID=0` is the id "0", not "unset".

This guards upgrades of a live release only. It reads the release's objects,
not the database, so a reinstall over a surviving database (an external DB, a
kept PVC) or a render without `lookup` (`helm template`, GitOps) isn't
checked; the README says so, and #956 tracks a database-side guard.

Never generated: `portalai.configData` renders twice per release (the config
ConfigMap and the hooks' copy), and on a first install `lookup` finds neither,
so a random value would differ between the two.
*/}}
{{- define "portalai.systemId" -}}
{{- $set := hasKey .Values.config "SYSTEM_ID" -}}
{{- $explicit := ternary (toString (get .Values.config "SYSTEM_ID")) "" $set -}}
{{- if and $set (eq (trim $explicit) "") -}}
{{- fail "config.SYSTEM_ID is blank: set the install's system principal (a UUID is recommended) or leave it out for \"SYSTEM\"" -}}
{{- end -}}
{{- if ne (trim $explicit) $explicit -}}
{{- fail (printf "config.SYSTEM_ID %q has surrounding whitespace: the id is stored as given, so set it without" $explicit) -}}
{{- end -}}
{{- $existing := "" -}}
{{- $fullname := include "portalai.fullname" . -}}
{{- /* The release's config ConfigMap; else the hooks' copy, which a failed
first install leaves behind after its pre-install hooks already wrote rows. */ -}}
{{- range $name := list (printf "%s-config" $fullname) (printf "%s-hook-config" $fullname) -}}
{{- if not $existing -}}
{{- with lookup "v1" "ConfigMap" $.Release.Namespace $name -}}
{{- $existing = get (default dict .data) "SYSTEM_ID" -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- if and $set $existing (ne $explicit $existing) -}}
{{- fail (printf "config.SYSTEM_ID is write-once: this install uses %q; changing it strands every platform row written under it (#953)" $existing) -}}
{{- end -}}
{{- coalesce $explicit $existing "SYSTEM" -}}
{{- end -}}

{{/*
The app's public origin (the ingress host), or "" without one.
*/}}
{{- define "portalai.publicScheme" -}}
{{- ternary "https" "http" .Values.ingress.tls.enabled -}}
{{- end -}}

{{/*
DATABASE_URL. Composed from the bundled postgresql service when enabled, else
from postgresql.external.
*/}}
{{- define "portalai.databaseUrl" -}}
{{- if .Values.postgresql.enabled -}}
{{- with .Values.postgresql.auth -}}
postgresql://{{ .username }}:{{ .password }}@{{ include "portalai.depName" (dict "root" $ "dep" "postgresql") }}:5432/{{ .database }}
{{- end -}}
{{- else -}}
{{- with .Values.postgresql.external -}}
postgresql://{{ .user }}:{{ .password }}@{{ .host }}:{{ .port }}/{{ .database }}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
REDIS_URL. The bundled redis service when enabled (auth off, in-cluster
only — evaluation-grade), else redis.external.url.
*/}}
{{- define "portalai.redisUrl" -}}
{{- if .Values.redis.enabled -}}
redis://{{ include "portalai.depName" (dict "root" . "dep" "redis") }}:6379
{{- else -}}
{{- .Values.redis.external.url -}}
{{- end -}}
{{- end -}}

{{/*
UPLOAD_S3_ENDPOINT. Bundled: the public host when set (presigned URLs carry
this host, and browsers PUT to it), else the in-cluster service. External:
objectStorage.external.endpoint.
*/}}
{{- define "portalai.s3Endpoint" -}}
{{- if .Values.objectStorage.enabled -}}
{{- if .Values.objectStorage.publicHost -}}
{{- printf "%s://%s" (include "portalai.publicScheme" .) .Values.objectStorage.publicHost -}}
{{- else -}}
{{- printf "http://%s:8333" (include "portalai.depName" (dict "root" . "dep" "s3")) -}}
{{- end -}}
{{- else -}}
{{- .Values.objectStorage.external.endpoint -}}
{{- end -}}
{{- end -}}

{{/*
UPLOAD_S3_BUCKET. The bundled bucket when enabled, else the external one.
*/}}
{{- define "portalai.s3Bucket" -}}
{{- if .Values.objectStorage.enabled -}}
{{- .Values.objectStorage.bucket -}}
{{- else -}}
{{- .Values.objectStorage.external.bucket -}}
{{- end -}}
{{- end -}}

{{/*
The bundled issuer's URL: <scheme>://<bundledIssuer.host>/realms/<realm>.
Refuses a render without the hosts it needs (#946).
*/}}
{{- define "portalai.bundledIssuerUrl" -}}
{{- $host := required "bundledIssuer.host is required with bundledIssuer.enabled: the issuer's public hostname, which browsers and the API pods both resolve" .Values.bundledIssuer.host -}}
{{- printf "%s://%s/realms/%s" (include "portalai.publicScheme" .) $host .Values.bundledIssuer.realm -}}
{{- end -}}

{{/*
The app origin the bundled issuer's client allows (redirect URI + web origin).
*/}}
{{- define "portalai.appOrigin" -}}
{{- if not .Values.ingress.enabled -}}
{{- fail "bundledIssuer.enabled needs the chart's ingress (ingress.enabled + ingress.host): the realm allows sign-in from the app's public origin" -}}
{{- end -}}
{{- $host := required "ingress.host is required with bundledIssuer.enabled: the realm allows sign-in from the app's public origin" .Values.ingress.host -}}
{{- printf "%s://%s" (include "portalai.publicScheme" .) $host -}}
{{- end -}}

{{/*
OIDC_ISSUER / OIDC_AUDIENCE / OIDC_CLIENT_ID: an explicit oidc.* value wins;
otherwise the bundled issuer's when it is enabled.
*/}}
{{- define "portalai.oidcIssuer" -}}
{{- if .Values.oidc.issuer -}}
{{- .Values.oidc.issuer -}}
{{- else if .Values.bundledIssuer.enabled -}}
{{- include "portalai.bundledIssuerUrl" . -}}
{{- end -}}
{{- end -}}
{{- define "portalai.oidcAudience" -}}
{{- if .Values.oidc.audience -}}
{{- .Values.oidc.audience -}}
{{- else if .Values.bundledIssuer.enabled -}}
{{- .Values.bundledIssuer.audience -}}
{{- end -}}
{{- end -}}
{{- define "portalai.oidcClientId" -}}
{{- if .Values.oidc.clientId -}}
{{- .Values.oidc.clientId -}}
{{- else if .Values.bundledIssuer.enabled -}}
{{- .Values.bundledIssuer.clientId -}}
{{- end -}}
{{- end -}}

{{/*
#660: env for the migration jobs only (migrate + upgrade), never the API pods.
MIGRATE_DATABASE_URL is a user able to CREATE ROLE, used only to provision the
restricted SQL reader role (migration 0118's DDL) and grant it to the app user;
the schema migrations themselves still run as DATABASE_URL, so the app user
owns every table. Bundled DB: its `postgres` superuser. External DB:
postgresql.external.migrationUser, when set; otherwise nothing is emitted and
the app user provisions the role itself (it then needs CREATEROLE). The password is passed separately as
MIGRATE_DATABASE_PASSWORD, never in the URL, so it needs no URL-encoding.
*/}}
{{- define "portalai.migrationEnv" -}}
{{- if .Values.postgresql.enabled }}
{{- $pg := include "portalai.depName" (dict "root" . "dep" "postgresql") }}
- name: MIGRATE_DATABASE_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ $pg }}
      key: postgres-password
- name: MIGRATE_DATABASE_URL
  value: {{ printf "postgresql://postgres@%s:5432/%s" $pg .Values.postgresql.auth.database | quote }}
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

{{/*
#946: bundled DB only. An init container that waits until the first-install
migrate Job has committed: drizzle applies a run's pending migrations in one
transaction and records them in drizzle.__drizzle_migrations, so a row there
means the schema is in place. Runs psql from the bundled DB's image with the
app's own DATABASE_URL. Call with the root context; `name` is fixed.
*/}}
{{- define "portalai.waitForMigrations" -}}
- name: wait-for-migrations
  image: "{{ .Values.postgresql.image.repository }}:{{ .Values.postgresql.image.tag }}"
  imagePullPolicy: {{ .Values.postgresql.image.pullPolicy }}
  command:
    - sh
    - -c
    - |
      until psql "$DATABASE_URL" -tAc 'select 1 from drizzle.__drizzle_migrations limit 1' 2>/dev/null | grep -q 1; do
        echo "waiting for the database migrations"; sleep 3
      done
  env:
    - name: DATABASE_URL
      valueFrom:
        secretKeyRef:
          name: {{ include "portalai.secretName" . }}
          key: DATABASE_URL
  securityContext:
    {{- toYaml .Values.containerSecurityContext | nindent 4 }}
{{- end -}}
