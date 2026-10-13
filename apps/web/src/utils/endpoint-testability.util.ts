/**
 * #780: which entities on a connector page offer "Test endpoint".
 *
 * Only a REST API connector's endpoint-backed entities can be tested; an
 * entity added with Create Entity has no endpoint. When the endpoint list
 * failed to load, every entity offers Test rather than none: a wrong guess
 * ends in the dialog's "not configured" result, while hiding Test would
 * leave the dialog unreachable again.
 */
export interface EndpointTestabilityInput {
  isRestApi: boolean;
  endpointsFailed: boolean;
  endpointEntityIds: ReadonlySet<string>;
}

export function isTestableEndpointEntity(
  entityId: string,
  { isRestApi, endpointsFailed, endpointEntityIds }: EndpointTestabilityInput
): boolean {
  if (!isRestApi) return false;
  return endpointsFailed || endpointEntityIds.has(entityId);
}
