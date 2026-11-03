{{- /*
The app's env, shared by the release's ConfigMap/Secret and the hook-scoped
copies the migrate/upgrade hook jobs read (hook-env.yaml, #946). Rendered
twice, so a value lives in one place.
*/ -}}

{{- define "portalai.configData" -}}
DEPLOY_MODE: {{ .Values.deployMode | quote }}
# The system principal: `createdBy` on platform seeds and provisioned
# defaults (#641); without it the API creates no users (#946). The chart owns
# it and every install uses "SYSTEM". Migrations read whatever value they're
# given (the `portalai.system_id` setting, #952), so this is the chart's
# choice, not a migration constraint; #953 tracks a per-install id.
{{- with get .Values.config "SYSTEM_ID" }}
{{- if ne . "SYSTEM" }}
{{- fail "config.SYSTEM_ID must be \"SYSTEM\": the chart owns the system principal (#953 tracks a per-install id), so leave it out" }}
{{- end }}
{{- end }}
SYSTEM_ID: "SYSTEM"
# Web config.js selects the auth provider from AUTH_PROVIDER; default it from
# the deploy mode so residency installs get OIDC without a second knob.
AUTH_PROVIDER: {{ if eq .Values.deployMode "residency" }}"oidc"{{ else }}"auth0"{{ end }}
# oidc.* when set, else the bundled issuer's (#946).
OIDC_ISSUER: {{ include "portalai.oidcIssuer" . | quote }}
OIDC_AUDIENCE: {{ include "portalai.oidcAudience" . | quote }}
OIDC_CLIENT_ID: {{ include "portalai.oidcClientId" . | quote }}
# Map basemap for the web config.js (#910); the chart defaults to none, so a
# fresh install sends no tile traffic off the cluster.
BASEMAP_MODE: {{ .Values.web.basemap.mode | quote }}
BASEMAP_STYLE_URL: {{ .Values.web.basemap.styleUrl | quote }}
BASEMAP_STYLE_URL_DARK: {{ .Values.web.basemap.styleUrlDark | quote }}
BASEMAP_ATTRIBUTION: {{ .Values.web.basemap.attribution | quote }}
# S3-compatible uploads (#567). Composed bundled-vs-external in _helpers.tpl.
UPLOAD_S3_ENDPOINT: {{ include "portalai.s3Endpoint" . | quote }}
UPLOAD_S3_BUCKET: {{ include "portalai.s3Bucket" . | quote }}
UPLOAD_S3_REGION: {{ if .Values.objectStorage.enabled }}"us-east-1"{{ else }}{{ .Values.objectStorage.external.region | quote }}{{ end }}
UPLOAD_S3_FORCE_PATH_STYLE: {{ if .Values.objectStorage.enabled }}"true"{{ else }}{{ .Values.objectStorage.external.forcePathStyle | quote }}{{ end }}
# The public URLs default from the ingress host, where the app and /api
# share one origin (#889, #891). WEB_APP_URL builds invite links;
# PUBLIC_API_BASE_URL is where webhook runtimes call back. An explicit
# config value wins (and renders below, so it isn't written twice); an empty
# one counts as unset, so the default still applies.
{{- $ingressOrigin := "" }}
{{- if and .Values.ingress.enabled .Values.ingress.host }}
{{- $ingressOrigin = printf "%s://%s" (ternary "https" "http" .Values.ingress.tls.enabled) .Values.ingress.host }}
{{- end }}
{{- if and $ingressOrigin (not (get .Values.config "WEB_APP_URL")) }}
WEB_APP_URL: {{ $ingressOrigin | quote }}
{{- end }}
{{- if and $ingressOrigin (not (get .Values.config "PUBLIC_API_BASE_URL")) }}
PUBLIC_API_BASE_URL: {{ $ingressOrigin | quote }}
{{- end }}
{{- range $key, $value := .Values.config }}
{{- if and (ne $key "SYSTEM_ID") (not (and (has $key (list "WEB_APP_URL" "PUBLIC_API_BASE_URL")) (empty $value))) }}
{{ $key }}: {{ $value | quote }}
{{- end }}
{{- end }}
{{- end }}

{{- define "portalai.secretData" -}}
# DATABASE_URL / REDIS_URL carry credentials, so they live in the Secret, not
# the ConfigMap. Composed bundled-vs-external in _helpers.tpl.
DATABASE_URL: {{ include "portalai.databaseUrl" . | quote }}
REDIS_URL: {{ include "portalai.redisUrl" . | quote }}
{{- range $key, $value := .Values.secrets }}
{{ $key }}: {{ $value | quote }}
{{- end }}
{{- end }}

{{- /* The Secret the hook jobs load: the operator's, or the chart's hook copy. */ -}}
{{- define "portalai.hookSecretName" -}}
{{- if .Values.existingSecret }}{{ .Values.existingSecret }}{{ else }}{{ include "portalai.fullname" . }}-hook-secret{{ end }}
{{- end }}
