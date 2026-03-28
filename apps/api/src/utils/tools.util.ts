import type { StationData } from "../services/analytics.service.js";

export function getRecords(
  stationData: StationData,
  entityKey: string
): Record<string, unknown>[] {
  const records = stationData.records.get(entityKey);
  if (!records) {
    throw new Error(`Entity "${entityKey}" not found in loaded station data`);
  }
  return records;
}
