/**
 * #685: how every mutation route (POST/PATCH/PUT/DELETE) and every SSE route
 * is authorized. #692 added every GET route: reads were never inventoried, and
 * the first inventory found by-id reads that crossed orgs. `route-authorization.test.ts` fails CI when a registered
 * route is missing here, or an entry names a route that no longer exists.
 *
 * This is a classification, not proof: each `authorized` entry names its
 * check, and the routes #685 fixed are also pinned by owner-vs-member and
 * cross-org integration tests. A new route must be added here with an honest
 * answer. If it has no server-side check yet, fix that first. Never mark a
 * route `authorized` to make the test pass.
 */

export type RouteAuthorization =
  | { kind: "authorized"; by: string }
  | { kind: "exempt"; reason: string };

export const ROUTE_AUTHORIZATION: Record<string, RouteAuthorization> = {
  "DELETE /api/column-definitions/{id}": {
    kind: "authorized",
    by: "org scope + read, else 404 (#713) + per-object resource.write/delete column_definition",
  },
  "DELETE /api/connector-entities/{connectorEntityId}/records": {
    kind: "authorized",
    by: "entity in org + class resource.write/delete entity_record",
  },
  "DELETE /api/connector-entities/{connectorEntityId}/records/{recordId}": {
    kind: "authorized",
    by: "entity in org + record on it + read, else 404 (#713) + per-object resource.write/delete entity_record",
  },
  "DELETE /api/connector-entities/{connectorEntityId}/tags/{assignmentId}": {
    kind: "authorized",
    by: "entity in org + readable + write entity; tag readable; assignment on the entity (#685)",
  },
  "DELETE /api/connector-entities/{id}": {
    kind: "authorized",
    by: "org scope + read, else 404 (#713) + per-object resource.write/delete entity (#599, #685)",
  },
  "DELETE /api/connector-instances/{id}": {
    kind: "authorized",
    by: "org scope + read, else 404 (#713) + per-object resource.write/delete connector_instance",
  },
  "DELETE /api/connector-instances/{instanceId}/api-endpoints/{entityId}": {
    kind: "authorized",
    by: "ConnectorInstanceAccessService.load (read for GET, write for changes) + entity on the instance (#685)",
  },
  "DELETE /api/curated-views/{id}": {
    kind: "authorized",
    by: "org scope + read, else 404 (#713) + per-object resource.write/delete curated_view",
  },
  "DELETE /api/curated-views/{id}/attach/{stationId}": {
    kind: "authorized",
    by: "loadWritableStation (org + read + write station) + view readable (StationAttachmentService)",
  },
  "DELETE /api/entity-groups/{entityGroupId}/members/{memberId}": {
    kind: "authorized",
    by: "group in org + readable + write entity_group; member on the group (#685)",
  },
  "DELETE /api/entity-groups/{id}": {
    kind: "authorized",
    by: "org scope + read, else 404 (#713) + per-object resource.write/delete entity_group",
  },
  "DELETE /api/entity-tags/{id}": {
    kind: "authorized",
    by: "org scope + read, else 404 (#713) + per-object resource.write/delete tag",
  },
  "DELETE /api/field-mappings/{id}": {
    kind: "authorized",
    by: "org scope + read, else 404 (#713) + per-object resource.write/delete field_mapping (#685)",
  },
  "DELETE /api/grants/{id}": {
    kind: "authorized",
    by: "GrantService: object in org + resource.share + granter boundary (#621)",
  },
  "DELETE /api/groups/{id}": {
    kind: "authorized",
    by: "Policy/Role/GroupService gate (customRbac entitlement + member.role.assign) + org-scoped load; policyIds via RbacPolicyRefsService (#681)",
  },
  "DELETE /api/organization/members/{userId}": {
    kind: "authorized",
    by: "SeatService member.remove + last-owner guard",
  },
  "DELETE /api/organization/{id}": {
    kind: "authorized",
    by: "caller's org + org.delete",
  },
  "DELETE /api/policies/{id}": {
    kind: "authorized",
    by: "Policy/Role/GroupService gate (customRbac entitlement + member.role.assign) + org-scoped load; policyIds via RbacPolicyRefsService (#681)",
  },
  "DELETE /api/portal-results/{id}": {
    kind: "authorized",
    by: "org scope + read, else 404 (#713) + per-object resource.write/delete pin (#621)",
  },
  "DELETE /api/portals/{id}": {
    kind: "authorized",
    by: "PortalAccessService.load write/delete (#685)",
  },
  "DELETE /api/portals/{id}/messages": {
    kind: "authorized",
    by: "PortalAccessService.load write (#685)",
  },
  "DELETE /api/roles/{id}": {
    kind: "authorized",
    by: "Policy/Role/GroupService gate (customRbac entitlement + member.role.assign) + org-scoped load; policyIds via RbacPolicyRefsService (#681)",
  },
  "DELETE /api/stations/{id}": {
    kind: "authorized",
    by: "org scope + read, else 404 (#713) + per-object resource.write/delete station",
  },
  "DELETE /api/toolpacks/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.write/delete toolpack (#685)",
  },
  "GET /api/billing/tiers": {
    kind: "authorized",
    by: "caller's current org (resolveCallerOrg membership); tiers selectable for that org only, no tenant data",
  },
  "GET /api/column-definitions": {
    kind: "authorized",
    by: "org filter + visibilityPredicate column_definition",
  },
  "GET /api/column-definitions/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.read column_definition (404)",
  },
  "GET /api/column-definitions/{id}/impact": {
    kind: "authorized",
    by: "org scope + per-object resource.read column_definition (404); counts only",
  },
  "GET /api/connector-config": {
    kind: "authorized",
    by: "login only; static non-tenant config, re-validated against a no-secrets schema",
  },
  "GET /api/connector-definitions": {
    kind: "authorized",
    by: "global catalog + visibilityPredicate connector_definition (#630)",
  },
  "GET /api/connector-definitions/{id}": {
    kind: "authorized",
    by: "per-object resource.read connector_definition, the list's rule (404) (#692)",
  },
  "GET /api/connector-entities": {
    kind: "authorized",
    by: "org filter + visibilityPredicate entity (#599)",
  },
  "GET /api/connector-entities/{connectorEntityId}/records": {
    kind: "authorized",
    by: "entity in org + readable (404) (#692) + entity_record visibilityPredicate",
  },
  "GET /api/connector-entities/{connectorEntityId}/records/count": {
    kind: "authorized",
    by: "entity in org + readable (404) (#692) + entity_record visibilityPredicate",
  },
  "GET /api/connector-entities/{connectorEntityId}/records/{recordId}": {
    kind: "authorized",
    by: "entity in org + readable (404) (#692) + record on it + per-object resource.read entity_record",
  },
  "GET /api/connector-entities/{connectorEntityId}/tags": {
    kind: "authorized",
    by: "entity in org + readable (404); only tags the caller may read (#692)",
  },
  "GET /api/connector-entities/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.read entity (404) (#599, #692)",
  },
  "GET /api/connector-entities/{id}/impact": {
    kind: "authorized",
    by: "org scope + per-object resource.read entity (404); counts org-scoped (#692)",
  },
  "GET /api/connector-entities/{id}/running-jobs": {
    kind: "authorized",
    by: "org scope + per-object resource.read entity (404); jobs queried by org",
  },
  "GET /api/connector-instances": {
    kind: "authorized",
    by: "org filter + visibilityPredicate connector_instance (#630)",
  },
  "GET /api/connector-instances/{connectorInstanceId}/layout-plan": {
    kind: "authorized",
    by: "ConnectorInstanceAccessService.load read (org + resource.read, 404) (#685)",
  },
  "GET /api/connector-instances/{connectorInstanceId}/layout-plan/edit-context":
    {
      kind: "authorized",
      by: "ConnectorInstanceAccessService.load read (org + resource.read, 404) (#685)",
    },
  "GET /api/connector-instances/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.read connector_instance (404); credentials redacted",
  },
  "GET /api/connector-instances/{id}/impact": {
    kind: "authorized",
    by: "org scope + per-object resource.read connector_instance (404)",
  },
  "GET /api/connector-instances/{id}/running-jobs": {
    kind: "authorized",
    by: "org scope + per-object resource.read connector_instance (404)",
  },
  "GET /api/connector-instances/{instanceId}/api-endpoints": {
    kind: "authorized",
    by: "ConnectorInstanceAccessService.load read + rest-api slug; endpoints of that instance (#685)",
  },
  "GET /api/connector-instances/{instanceId}/api-endpoints/{entityId}": {
    kind: "authorized",
    by: "ConnectorInstanceAccessService.load read + endpoint entity in org and on the instance (#685)",
  },
  "GET /api/connectors/google-sheets/callback": {
    kind: "exempt",
    reason:
      "OAuth redirect, no JWT; HMAC-signed state (timing-safe, 5-min TTL) names user+org; reconnect target re-checked in that org; a new instance re-checks the owned create (#710)",
  },
  "GET /api/connectors/google-sheets/instances/{id}/sheet-slice": {
    kind: "authorized",
    by: "ConnectorInstanceAccessService.load read (org + resource.read, 404) (#685)",
  },
  "GET /api/connectors/microsoft-excel/callback": {
    kind: "exempt",
    reason:
      "OAuth redirect, no JWT; HMAC-signed state (timing-safe, 5-min TTL) names user+org; reconnect target re-checked in that org; a new instance re-checks the owned create (#710)",
  },
  "GET /api/connectors/microsoft-excel/instances/{id}/sheet-slice": {
    kind: "authorized",
    by: "ConnectorInstanceAccessService.load read (org + resource.read, 404) (#685)",
  },
  "GET /api/connectors/microsoft-excel/workbooks": {
    kind: "authorized",
    by: "ConnectorInstanceAccessService.load read on ?connectorInstanceId (org + resource.read, 404)",
  },
  "GET /api/curated-views": {
    kind: "authorized",
    by: "org filter + visibilityPredicate curated_view; ?stationId in org + readable (404) (#692)",
  },
  "GET /api/curated-views/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.read curated_view (404); payload scoped by CuratedViewPayloadService (#680)",
  },
  "GET /api/curated-views/{id}/records": {
    kind: "authorized",
    by: "PortalSqlService.resolveViewColumnsById: org + read curated_view + field grants",
  },
  "GET /api/docs": {
    kind: "exempt",
    reason:
      "public Swagger UI (static API documentation), mounted before jwtCheck; no tenant data",
  },
  "GET /api/docs/spec": {
    kind: "exempt",
    reason:
      "public OpenAPI JSON (static spec), mounted before jwtCheck; no tenant data",
  },
  "GET /api/entity-groups": {
    kind: "authorized",
    by: "org filter + visibilityPredicate entity_group (#630)",
  },
  "GET /api/entity-groups/{entityGroupId}/members": {
    kind: "authorized",
    by: "group in org + readable (404) (#692)",
  },
  "GET /api/entity-groups/{entityGroupId}/members/overlap": {
    kind: "authorized",
    by: "group in org + readable; target entity in org + readable (404); target mapping in org + on it (400) (#692)",
  },
  "GET /api/entity-groups/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.read entity_group (404)",
  },
  "GET /api/entity-groups/{id}/impact": {
    kind: "authorized",
    by: "org scope + per-object resource.read entity_group (404)",
  },
  "GET /api/entity-groups/{id}/resolve": {
    kind: "authorized",
    by: "org scope + per-object read entity_group (404) + entity_record visibilityPredicate per member",
  },
  "GET /api/entity-tags": {
    kind: "authorized",
    by: "org filter + visibilityPredicate tag (#630)",
  },
  "GET /api/entity-tags/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.read tag (404)",
  },
  "GET /api/field-mappings": {
    kind: "authorized",
    by: "org filter + visibilityPredicate field_mapping (#692)",
  },
  "GET /api/field-mappings/{id}": {
    kind: "authorized",
    by: "loadReadableMapping: org scope + per-object resource.read field_mapping (404) (#692)",
  },
  "GET /api/field-mappings/{id}/impact": {
    kind: "authorized",
    by: "loadReadableMapping (404); counterpart only when readable (#692)",
  },
  "GET /api/field-mappings/{id}/validate-bidirectional": {
    kind: "authorized",
    by: "loadReadableMapping (org + read field_mapping, 404) (#692)",
  },
  "GET /api/file-uploads/sheet-slice": {
    kind: "authorized",
    by: "FileUploadAccessService.assertOwnUploadSession: uploader-only, in org (404) (#692)",
  },
  "GET /api/grants": {
    kind: "authorized",
    by: "GrantService.list: object in org + readable (404) + resource.share (#621, #692)",
  },
  "GET /api/groups": {
    kind: "authorized",
    by: "GroupService gate (customRbac entitlement + member.role.assign) + org-scoped list",
  },
  "GET /api/groups/{id}": {
    kind: "authorized",
    by: "GroupService gate (customRbac entitlement + member.role.assign) + org-scoped load (404)",
  },
  "GET /api/groups/{id}/members": {
    kind: "authorized",
    by: "org membership + org-scoped group load (404); roster read by design (#637)",
  },
  "GET /api/health": {
    kind: "exempt",
    reason:
      "unauthenticated liveness probe; returns only timestamp/build version/sha",
  },
  "GET /api/health/ready": {
    kind: "exempt",
    reason: "unauthenticated readiness probe; returns only db/redis booleans",
  },
  "GET /api/jobs": {
    kind: "authorized",
    by: "org filter + visibilityPredicate job; metadata/result redacted unless creator or job control (#692)",
  },
  "GET /api/jobs/{id}": {
    kind: "authorized",
    by: "org + resource.read job (404); metadata/result redacted unless creator or job control (#692)",
  },
  "GET /api/organization/audit-log": {
    kind: "authorized",
    by: "org-scoped findPage + org.audit.read capability",
  },
  "GET /api/organization/current": {
    kind: "authorized",
    by: "caller resolved from JWT sub -> own active org membership only",
  },
  "GET /api/organization/invitations": {
    kind: "authorized",
    by: "SeatService.listInvitations: member.invite capability + org-scoped",
  },
  "GET /api/organization/members": {
    kind: "authorized",
    by: "org membership + org-scoped roster; roster read by design (#621)",
  },
  "GET /api/organization/memberships": {
    kind: "exempt",
    reason:
      "the caller's own memberships, resolved from the JWT sub; no id input",
  },
  "GET /api/organization/usage": {
    kind: "authorized",
    by: "caller resolved from JWT sub -> own active org's tier/balance (member-visible by design)",
  },
  "GET /api/organization/usage/ledger": {
    kind: "authorized",
    by: "org-scoped findPage; member-visible Settings usage by design",
  },
  "GET /api/policies": {
    kind: "authorized",
    by: "PolicyService gate (customRbac entitlement + member.role.assign) + org-scoped list",
  },
  "GET /api/policies/{id}": {
    kind: "authorized",
    by: "PolicyService gate (customRbac entitlement + member.role.assign) + org-scoped load (404)",
  },
  "GET /api/portal-map/tiles/message/{messageId}/{blockIndex}/{z}/{x}/{y}": {
    kind: "authorized",
    by: "message in org + PortalAccessService read on its portal via authorizeSource (404) (#692)",
  },
  "GET /api/portal-map/tiles/pin/{portalResultId}/{z}/{x}/{y}": {
    kind: "authorized",
    by: "pin in org + resource.read pin via authorizeSource (404) (#692); rows caller-view-scoped (#643)",
  },
  "GET /api/portal-results": {
    kind: "authorized",
    by: "org filter + visibilityPredicate pin (#621)",
  },
  "GET /api/portal-results/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.read pin (404) (#621)",
  },
  "GET /api/portal-sql/handle/{handleId}": {
    kind: "authorized",
    by: "handle meta org === caller org, and _userId === caller when present (404) (#685)",
  },
  "GET /api/portals": {
    kind: "authorized",
    by: "org filter + visibilityPredicate portal (per-user, #685)",
  },
  "GET /api/portals/{id}": {
    kind: "authorized",
    by: "PortalAccessService.load (org + resource.read portal, 404) (#685)",
  },
  "GET /api/portals/{id}/running-jobs": {
    kind: "authorized",
    by: "PortalAccessService.load (org + read portal) + org-scoped running jobs (id/type/status)",
  },
  "GET /api/profile": {
    kind: "exempt",
    reason:
      "the caller's own Auth0 profile + user row, resolved from the caller's own bearer token",
  },
  "GET /api/public/site-config": {
    kind: "exempt",
    reason:
      "public marketing config (public tiers, prices, contacts); no tenant data, mounted before jwtCheck",
  },
  "GET /api/rbac/objects": {
    kind: "authorized",
    by: "customRbac entitlement + member.role.assign + org filter + visibilityPredicate per type",
  },
  "GET /api/roles": {
    kind: "authorized",
    by: "RoleService gate (customRbac entitlement + member.role.assign) + org-scoped list",
  },
  "GET /api/roles/{id}": {
    kind: "authorized",
    by: "RoleService gate (customRbac entitlement + member.role.assign) + org-scoped load (404)",
  },
  "GET /api/sse/jobs/{id}/events": {
    kind: "authorized",
    by: "getApplicationMetadata + same org + resource.read job (#685); result/custom events redacted unless creator or job control (#692)",
  },
  "GET /api/sse/portals/{portalId}/events": {
    kind: "authorized",
    by: "getApplicationMetadata + PortalAccessService.load (read; a turn also needs write); the turn runs as the caller (#685)",
  },
  "GET /api/sse/portals/{portalId}/stream": {
    kind: "authorized",
    by: "getApplicationMetadata + PortalAccessService.load (read; a turn also needs write); the turn runs as the caller (#685)",
  },
  "GET /api/stations": {
    kind: "authorized",
    by: "org filter + visibilityPredicate station (#621)",
  },
  "GET /api/stations/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.read station (404); unreadable attachments reduced to id/name (#674)",
  },
  "GET /api/toolpacks": {
    kind: "authorized",
    by: "requirePermission class resource.read toolpack + org-scoped custom rows; secrets never returned",
  },
  "GET /api/toolpacks/{id}": {
    kind: "authorized",
    by: "requirePermission class resource.read toolpack + findByIdScoped(id, org)",
  },
  "GET /api/webhook/handle/{handleId}": {
    kind: "exempt",
    reason:
      "no user JWT; Redis bearer token scoped to this handle, mode read, unexpired, and its org must own the handle",
  },
  "PATCH /api/column-definitions/{id}": {
    kind: "authorized",
    by: "org scope + read, else 404 (#713) + per-object resource.write/delete column_definition",
  },
  "PATCH /api/connector-entities/{connectorEntityId}/records/{recordId}": {
    kind: "authorized",
    by: "entity in org + record on it + read, else 404 (#713) + per-object resource.write/delete entity_record",
  },
  "PATCH /api/connector-entities/{id}": {
    kind: "authorized",
    by: "org scope + read, else 404 (#713) + per-object resource.write/delete entity (#599, #685)",
  },
  "PATCH /api/connector-instances/{connectorInstanceId}/layout-plan/{planId}": {
    kind: "authorized",
    by: "ConnectorInstanceAccessService.load write (#685)",
  },
  "PATCH /api/connector-instances/{id}": {
    kind: "authorized",
    by: "org scope + read, else 404 (#713) + per-object resource.write/delete connector_instance",
  },
  "PATCH /api/connector-instances/{instanceId}/api-endpoints/{entityId}": {
    kind: "authorized",
    by: "ConnectorInstanceAccessService.load (read for GET, write for changes) + entity on the instance (#685)",
  },
  "PATCH /api/curated-views/{id}": {
    kind: "authorized",
    by: "org scope + read, else 404 (#713) + per-object resource.write/delete curated_view",
  },
  "PATCH /api/entity-groups/{entityGroupId}/members/{memberId}": {
    kind: "authorized",
    by: "group in org + readable + write entity_group; member on the group (#685)",
  },
  "PATCH /api/entity-groups/{id}": {
    kind: "authorized",
    by: "org scope + read, else 404 (#713) + per-object resource.write/delete entity_group",
  },
  "PATCH /api/entity-tags/{id}": {
    kind: "authorized",
    by: "org scope + read, else 404 (#713) + per-object resource.write/delete tag",
  },
  "PATCH /api/field-mappings/{id}": {
    kind: "authorized",
    by: "org scope + read, else 404 (#713) + per-object resource.write/delete field_mapping (#685)",
  },
  "PATCH /api/organization/{id}": {
    kind: "authorized",
    by: "caller's org + class resource.write station for the default station, station readable (#685)",
  },
  "PATCH /api/portal-results/{id}": {
    kind: "authorized",
    by: "org scope + read, else 404 (#713) + per-object resource.write/delete pin (#621)",
  },
  "PATCH /api/portals/{id}": {
    kind: "authorized",
    by: "PortalAccessService.load write/delete (#685)",
  },
  "PATCH /api/stations/{id}": {
    kind: "authorized",
    by: "org scope + read, else 404 (#713) + per-object resource.write/delete station",
  },
  "PATCH /api/toolpacks/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.write/delete toolpack (#685)",
  },
  "POST /api/billing/checkout": {
    kind: "authorized",
    by: "BillingService billing.manage",
  },
  "POST /api/billing/portal": {
    kind: "authorized",
    by: "BillingService billing.manage",
  },
  "POST /api/column-definitions": {
    kind: "authorized",
    by: "class resource.write column_definition (owner/admin) (#685)",
  },
  "POST /api/connector-entities": {
    kind: "authorized",
    by: "instance in org + readable, owned create resource.write entity (#685)",
  },
  "POST /api/connector-entities/{connectorEntityId}/records": {
    kind: "authorized",
    by: "entity in org + readable, owned create resource.write entity_record (#685)",
  },
  "POST /api/connector-entities/{connectorEntityId}/records/import": {
    kind: "authorized",
    by: "entity in org + class resource.write/delete entity_record",
  },
  "POST /api/connector-entities/{connectorEntityId}/records/revalidate": {
    kind: "authorized",
    by: "entity in org + class resource.write/delete entity_record",
  },
  "POST /api/connector-entities/{connectorEntityId}/tags": {
    kind: "authorized",
    by: "entity in org + readable + write entity; tag readable; assignment on the entity (#685)",
  },
  "POST /api/connector-entities/{id}/rows-by-id": {
    kind: "authorized",
    by: "org scope + per-object resource.read entity (read-only)",
  },
  "POST /api/connector-instances": {
    kind: "authorized",
    by: "caller's org (body org refused) + owned create resource.write connector_instance (#685)",
  },
  "POST /api/connector-instances/preview-endpoint-page": {
    kind: "authorized",
    by: "owned create resource.write connector_instance (#685)",
  },
  "POST /api/connector-instances/probe-endpoint-draft": {
    kind: "authorized",
    by: "owned create resource.write connector_instance (#685)",
  },
  "POST /api/connector-instances/suggest-transform": {
    kind: "authorized",
    by: "owned create resource.write connector_instance (#685)",
  },
  "POST /api/connector-instances/{connectorInstanceId}/layout-plan/interpret": {
    kind: "authorized",
    by: "ConnectorInstanceAccessService.load write (#685)",
  },
  "POST /api/connector-instances/{connectorInstanceId}/layout-plan/{planId}/commit":
    {
      kind: "authorized",
      by: "ConnectorInstanceAccessService.load write (#685)",
    },
  "POST /api/connector-instances/{id}/sync": {
    kind: "authorized",
    by: "org scope + read, else 404 (#713) + per-object resource.write/delete connector_instance",
  },
  "POST /api/connector-instances/{id}/test-connection": {
    kind: "authorized",
    by: "org scope + per-object resource.read connector_instance (no state change)",
  },
  "POST /api/connector-instances/{instanceId}/api-endpoints": {
    kind: "authorized",
    by: "ConnectorInstanceAccessService.load (read for GET, write for changes) + entity on the instance (#685)",
  },
  "POST /api/connector-instances/{instanceId}/api-endpoints/{entityId}/discover-columns":
    {
      kind: "authorized",
      by: "ConnectorInstanceAccessService.load (read for GET, write for changes) + entity on the instance (#685)",
    },
  "POST /api/connectors/google-sheets/authorize": {
    kind: "authorized",
    by: "reconnect needs ConnectorInstanceAccessService write (#685); a new connection needs the owned connector_instance create (assertCanCreate, #710)",
  },
  "POST /api/connectors/google-sheets/instances/{id}/select-sheet": {
    kind: "authorized",
    by: "resolveOwnedInstance \u2192 ConnectorInstanceAccessService write (#685)",
  },
  "POST /api/connectors/microsoft-excel/authorize": {
    kind: "authorized",
    by: "reconnect needs ConnectorInstanceAccessService write (#685); a new connection needs the owned connector_instance create (assertCanCreate, #710)",
  },
  "POST /api/connectors/microsoft-excel/instances/{id}/select-workbook": {
    kind: "authorized",
    by: "resolveOwnedInstance \u2192 ConnectorInstanceAccessService write (#685)",
  },
  "POST /api/curated-views": {
    kind: "authorized",
    by: "class resource.write curated_view (owner/admin)",
  },
  "POST /api/curated-views/{id}/attach": {
    kind: "authorized",
    by: "loadWritableStation (org + read + write station) + view readable (StationAttachmentService)",
  },
  "POST /api/entity-groups": {
    kind: "authorized",
    by: "class resource.write entity_group (owner/admin) (#685)",
  },
  "POST /api/entity-groups/{entityGroupId}/members": {
    kind: "authorized",
    by: "group in org + readable + write entity_group; member on the group (#685)",
  },
  "POST /api/entity-tags": {
    kind: "authorized",
    by: "class resource.write tag (owner/admin) (#685)",
  },
  "POST /api/field-mappings": {
    kind: "authorized",
    by: "entity in org + readable, column definition in org, owned create resource.write field_mapping (#685)",
  },
  "POST /api/file-uploads/confirm": {
    kind: "authorized",
    by: "FileUploadAccessService.assertOwnUploads (#685)",
  },
  "POST /api/file-uploads/parse": {
    kind: "authorized",
    by: "FileUploadAccessService.assertOwnUploads (#685)",
  },
  "POST /api/file-uploads/presign": {
    kind: "authorized",
    by: "creates uploads in the caller's org, owned by the caller",
  },
  "POST /api/grants": {
    kind: "authorized",
    by: "GrantService: object in org + resource.share + granter boundary (#621)",
  },
  "POST /api/groups": {
    kind: "authorized",
    by: "Policy/Role/GroupService gate (customRbac entitlement + member.role.assign) + org-scoped load; policyIds via RbacPolicyRefsService (#681)",
  },
  "POST /api/jobs/{id}/cancel": {
    kind: "authorized",
    by: "org scope + creator, else class resource.delete job",
  },
  "POST /api/layout-plans/commit": {
    kind: "authorized",
    by: "source writable: own upload session (FileUploadAccessService) or ConnectorInstanceAccessService (#685); a new connection needs the owned connector_instance create (assertCanCreate, #710)",
  },
  "POST /api/layout-plans/interpret": {
    kind: "authorized",
    by: "source readable/writable: own upload session (FileUploadAccessService) or ConnectorInstanceAccessService (#685)",
  },
  "POST /api/organization/invitations": {
    kind: "authorized",
    by: "SeatService member.invite, org-scoped",
  },
  "POST /api/organization/invitations/accept": {
    kind: "exempt",
    reason:
      "bearer invitation token (hashed, single use); the token is the authorization",
  },
  "POST /api/organization/invitations/{id}/resend": {
    kind: "authorized",
    by: "SeatService member.invite, org-scoped",
  },
  "POST /api/organization/invitations/{id}/revoke": {
    kind: "authorized",
    by: "SeatService member.invite, org-scoped",
  },
  "POST /api/organization/switch": {
    kind: "authorized",
    by: "the caller's own membership row only (ApplicationService.switchOrganization)",
  },
  "POST /api/policies": {
    kind: "authorized",
    by: "Policy/Role/GroupService gate (customRbac entitlement + member.role.assign) + org-scoped load; policyIds via RbacPolicyRefsService (#681)",
  },
  "POST /api/portal-results": {
    kind: "authorized",
    by: "owned create resource.write pin + source portal via PortalAccessService (#621, #685)",
  },
  "POST /api/portal-results/{id}/refresh": {
    kind: "authorized",
    by: "org scope + read, else 404 (#713) + per-object resource.write/delete pin (#621)",
  },
  "POST /api/portal-sql/widget-refresh": {
    kind: "authorized",
    by: "message's portal via PortalAccessService; SQL re-runs as the caller (#685)",
  },
  "POST /api/portals": {
    kind: "authorized",
    by: "station readable by the caller + owned create resource.write portal (#685)",
  },
  "POST /api/portals/{id}/messages": {
    kind: "authorized",
    by: "PortalAccessService.load write (#685)",
  },
  "POST /api/roles": {
    kind: "authorized",
    by: "Policy/Role/GroupService gate (customRbac entitlement + member.role.assign) + org-scoped load; policyIds via RbacPolicyRefsService (#681)",
  },
  "POST /api/stations": {
    kind: "authorized",
    by: "owned create resource.write station",
  },
  "POST /api/toolpacks": {
    kind: "authorized",
    by: "class resource.write toolpack, then the customToolpacks entitlement (#685)",
  },
  "POST /api/toolpacks/{id}/refresh": {
    kind: "authorized",
    by: "org scope + per-object resource.write/delete toolpack (#685)",
  },
  "POST /api/toolpacks/{id}/rotate-signing-secret": {
    kind: "authorized",
    by: "org scope + per-object resource.write/delete toolpack (#685)",
  },
  "POST /api/webhook/handle/{sessionId}": {
    kind: "exempt",
    reason:
      "custom-tool runtime: scoped write token bound to the handle, fail-closed",
  },
  "POST /api/webhooks/aws-marketplace": {
    kind: "exempt",
    reason:
      "public: SNS X.509 signature verified; the grant re-reads the entitlement from AWS",
  },
  "POST /api/webhooks/stripe": {
    kind: "exempt",
    reason:
      "public: Stripe signature verified over the raw body (constructEvent)",
  },
  "PUT /api/groups/{id}": {
    kind: "authorized",
    by: "Policy/Role/GroupService gate (customRbac entitlement + member.role.assign) + org-scoped load; policyIds via RbacPolicyRefsService (#681)",
  },
  "PUT /api/groups/{id}/members": {
    kind: "authorized",
    by: "Policy/Role/GroupService gate (customRbac entitlement + member.role.assign) + org-scoped load; policyIds via RbacPolicyRefsService (#681)",
  },
  "PUT /api/organization/members/{userId}/groups": {
    kind: "authorized",
    by: "GroupService gate + assertMembers",
  },
  "PUT /api/organization/members/{userId}/roles": {
    kind: "authorized",
    by: "SeatService member.role.assign",
  },
  "PUT /api/policies/{id}": {
    kind: "authorized",
    by: "Policy/Role/GroupService gate (customRbac entitlement + member.role.assign) + org-scoped load; policyIds via RbacPolicyRefsService (#681)",
  },
  "PUT /api/roles/{id}": {
    kind: "authorized",
    by: "Policy/Role/GroupService gate (customRbac entitlement + member.role.assign) + org-scoped load; policyIds via RbacPolicyRefsService (#681)",
  },
};
