/**
 * #713: what a page should render from a query. React Query keeps the last
 * good `data` when a refetch fails, so rendering `data` whenever it's present
 * shows an object that has since gone (deleted, or the caller's access
 * revoked under an open page), with its actions still offered. The latest
 * result wins: a failed fetch renders nothing, as `DataResult` does.
 */
export function freshData<T>(result: {
  data: T | undefined;
  isError: boolean;
}): T | undefined {
  return result.isError ? undefined : result.data;
}
