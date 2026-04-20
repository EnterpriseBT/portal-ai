/**
 * Service layer for database transaction management.
 *
 * Wraps {@link Repository} transaction helpers so that route handlers and
 * other services can manage transactions without importing the repository
 * layer directly.
 */

import {
  organizationsRepo,
  organizationUsersRepo,
  usersRepo,
  connectorDefinitionsRepo,
  connectorInstancesRepo,
  jobsRepo,
  columnDefinitionsRepo,
  connectorEntitiesRepo,
  fieldMappingsRepo,
  entityRecordsRepo,
  entityTagsRepo,
  entityTagAssignmentsRepo,
  entityGroupsRepo,
  entityGroupMembersRepo,
  stationsRepo,
  stationInstancesRepo,
  portalsRepo,
  portalMessagesRepo,
  portalResultsRepo,
  organizationToolsRepo,
  stationToolsRepo,
  connectorInstanceLayoutPlansRepo,
} from "../db/index.js";
import {
  Repository,
  type DbTransaction,
  type TransactionClient,
} from "../db/repositories/base.repository.js";

export class DbService {
  /**
   * Run a callback inside a database transaction.
   *
   * The transaction is committed when the callback resolves, or rolled back
   * when it rejects.
   *
   * @example
   *   const result = await DbService.transaction(async (tx) => {
   *     const org  = await orgsRepo.create(orgData, tx);
   *     const link = await orgUsersRepo.create({ organizationId: org.id, ...rest }, tx);
   *     return { org, link };
   *   });
   */
  static async transaction<R>(
    fn: (tx: DbTransaction) => Promise<R>
  ): Promise<R> {
    return Repository.transaction(fn);
  }

  /**
   * Create a manually controlled transaction.
   *
   * Returns a {@link TransactionClient} whose `tx` can be passed to any
   * repository method. The caller **must** call either `commit()` or
   * `rollback()` to release the underlying connection.
   *
   * @example
   *   const { tx, commit, rollback } = await DbService.createTransactionClient();
   *   try {
   *     await usersRepo.create(userData, tx);
   *     await orgsRepo.create(orgData, tx);
   *     await commit();
   *   } catch (err) {
   *     await rollback();
   *     throw err;
   *   }
   */
  static async createTransactionClient(): Promise<TransactionClient> {
    return Repository.createTransactionClient();
  }

  static get repository() {
    return {
      organizationUsers: organizationUsersRepo,
      users: usersRepo,
      organizations: organizationsRepo,
      connectorDefinitions: connectorDefinitionsRepo,
      connectorInstances: connectorInstancesRepo,
      jobs: jobsRepo,
      columnDefinitions: columnDefinitionsRepo,
      connectorEntities: connectorEntitiesRepo,
      fieldMappings: fieldMappingsRepo,
      entityRecords: entityRecordsRepo,
      entityTags: entityTagsRepo,
      entityTagAssignments: entityTagAssignmentsRepo,
      entityGroups: entityGroupsRepo,
      entityGroupMembers: entityGroupMembersRepo,
      stations: stationsRepo,
      stationInstances: stationInstancesRepo,
      portals: portalsRepo,
      portalMessages: portalMessagesRepo,
      portalResults: portalResultsRepo,
      organizationTools: organizationToolsRepo,
      stationTools: stationToolsRepo,
      connectorInstanceLayoutPlans: connectorInstanceLayoutPlansRepo,
    };
  }
}
