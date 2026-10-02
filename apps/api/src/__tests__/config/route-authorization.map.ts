/**
 * #685: how every mutation route (POST/PATCH/PUT/DELETE) and every SSE route
 * is authorized. `route-authorization.test.ts` fails CI when a registered
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
    by: "org scope + per-object resource.write/delete column_definition",
  },
  "DELETE /api/connector-entities/{connectorEntityId}/records": {
    kind: "authorized",
    by: "entity in org + class resource.write/delete entity_record",
  },
  "DELETE /api/connector-entities/{connectorEntityId}/records/{recordId}": {
    kind: "authorized",
    by: "entity in org + record on it + per-object resource.write/delete entity_record",
  },
  "DELETE /api/connector-entities/{connectorEntityId}/tags/{assignmentId}": {
    kind: "authorized",
    by: "entity in org + readable + write entity; tag readable; assignment on the entity (#685)",
  },
  "DELETE /api/connector-entities/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.write/delete entity (#599, #685)",
  },
  "DELETE /api/connector-instances/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.write/delete connector_instance",
  },
  "DELETE /api/connector-instances/{instanceId}/api-endpoints/{entityId}": {
    kind: "authorized",
    by: "ConnectorInstanceAccessService.load (read for GET, write for changes) + entity on the instance (#685)",
  },
  "DELETE /api/curated-views/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.write/delete curated_view",
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
    by: "org scope + per-object resource.write/delete entity_group",
  },
  "DELETE /api/entity-tags/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.write/delete tag",
  },
  "DELETE /api/field-mappings/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.write/delete field_mapping (#685)",
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
    by: "org scope + per-object resource.write/delete pin (#621)",
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
    by: "org scope + per-object resource.write/delete station",
  },
  "DELETE /api/toolpacks/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.write/delete toolpack (#685)",
  },
  "GET /api/sse/jobs/{id}/events": {
    kind: "authorized",
    by: "getApplicationMetadata + same org + resource.read job (#685)",
  },
  "GET /api/sse/portals/{portalId}/events": {
    kind: "authorized",
    by: "getApplicationMetadata + PortalAccessService.load (read; a turn also needs write); the turn runs as the caller (#685)",
  },
  "GET /api/sse/portals/{portalId}/stream": {
    kind: "authorized",
    by: "getApplicationMetadata + PortalAccessService.load (read; a turn also needs write); the turn runs as the caller (#685)",
  },
  "PATCH /api/column-definitions/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.write/delete column_definition",
  },
  "PATCH /api/connector-entities/{connectorEntityId}/records/{recordId}": {
    kind: "authorized",
    by: "entity in org + record on it + per-object resource.write/delete entity_record",
  },
  "PATCH /api/connector-entities/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.write/delete entity (#599, #685)",
  },
  "PATCH /api/connector-instances/{connectorInstanceId}/layout-plan/{planId}": {
    kind: "authorized",
    by: "ConnectorInstanceAccessService.load write (#685)",
  },
  "PATCH /api/connector-instances/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.write/delete connector_instance",
  },
  "PATCH /api/connector-instances/{instanceId}/api-endpoints/{entityId}": {
    kind: "authorized",
    by: "ConnectorInstanceAccessService.load (read for GET, write for changes) + entity on the instance (#685)",
  },
  "PATCH /api/curated-views/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.write/delete curated_view",
  },
  "PATCH /api/entity-groups/{entityGroupId}/members/{memberId}": {
    kind: "authorized",
    by: "group in org + readable + write entity_group; member on the group (#685)",
  },
  "PATCH /api/entity-groups/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.write/delete entity_group",
  },
  "PATCH /api/entity-tags/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.write/delete tag",
  },
  "PATCH /api/field-mappings/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.write/delete field_mapping (#685)",
  },
  "PATCH /api/organization/{id}": {
    kind: "authorized",
    by: "caller's org + class resource.write station for the default station, station readable (#685)",
  },
  "PATCH /api/portal-results/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.write/delete pin (#621)",
  },
  "PATCH /api/portals/{id}": {
    kind: "authorized",
    by: "PortalAccessService.load write/delete (#685)",
  },
  "PATCH /api/stations/{id}": {
    kind: "authorized",
    by: "org scope + per-object resource.write/delete station",
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
    by: "org scope + per-object resource.write/delete connector_instance",
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
    by: "reconnect needs ConnectorInstanceAccessService write; a new connection is the caller's own (#685)",
  },
  "POST /api/connectors/google-sheets/instances/{id}/select-sheet": {
    kind: "authorized",
    by: "resolveOwnedInstance \u2192 ConnectorInstanceAccessService write (#685)",
  },
  "POST /api/connectors/microsoft-excel/authorize": {
    kind: "authorized",
    by: "reconnect needs ConnectorInstanceAccessService write; a new connection is the caller's own (#685)",
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
    by: "source readable/writable: own upload session (FileUploadAccessService) or ConnectorInstanceAccessService (#685)",
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
    by: "org scope + per-object resource.write/delete pin (#621)",
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
