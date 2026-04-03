import { DbService } from "./db.service.js";

/**
 * Normalizes raw entity record data through field mappings.
 *
 * Projects `data` keys through the `sourceField → columnDefinition.key`
 * mapping for a given connector entity. When no field mappings exist,
 * falls back to a passthrough copy of the input data.
 */
export class NormalizationService {
  static async normalize(
    connectorEntityId: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const mappings = await DbService.repository.fieldMappings.findMany(
      undefined,
      { include: ["columnDefinition"] },
    );

    // Filter to mappings belonging to this entity that have a column definition
    const entityMappings = mappings.filter(
      (m: any) =>
        m.connectorEntityId === connectorEntityId && m.columnDefinition,
    );

    if (entityMappings.length === 0) {
      return { ...data };
    }

    const normalizedData: Record<string, unknown> = {};
    for (const mapping of entityMappings) {
      const sourceField = (mapping as any).sourceField as string;
      const colKey = (mapping as any).columnDefinition.key as string;
      if (sourceField in data) {
        normalizedData[colKey] = data[sourceField];
      }
    }

    return normalizedData;
  }
}
