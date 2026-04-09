import { describe, it, expect } from "@jest/globals";
import { queryKeys } from "../../api/keys";

/**
 * Verifies that query key hierarchies support prefix-based invalidation.
 * For example, invalidating `queryKeys.fieldMappings.root` must also
 * invalidate `queryKeys.fieldMappings.list(...)` because TanStack Query
 * uses prefix matching with `invalidateQueries({ queryKey })`.
 */
describe("query key structure — prefix invalidation support", () => {
  describe("fieldMappings", () => {
    it("root is a prefix of list()", () => {
      const root = queryKeys.fieldMappings.root;
      const list = queryKeys.fieldMappings.list();
      expect(list.slice(0, root.length)).toEqual(root);
    });

    it("root is a prefix of validateBidirectional()", () => {
      const root = queryKeys.fieldMappings.root;
      const key = queryKeys.fieldMappings.validateBidirectional("fm-1");
      expect(key.slice(0, root.length)).toEqual(root);
    });

    it("root is a prefix of impact()", () => {
      const root = queryKeys.fieldMappings.root;
      const key = queryKeys.fieldMappings.impact("fm-1");
      expect(key.slice(0, root.length)).toEqual(root);
    });
  });

  describe("entityRecords", () => {
    it("root is a prefix of list()", () => {
      const root = queryKeys.entityRecords.root;
      const list = queryKeys.entityRecords.list("ce-1");
      expect(list.slice(0, root.length)).toEqual(root);
    });

    it("root is a prefix of count()", () => {
      const root = queryKeys.entityRecords.root;
      const key = queryKeys.entityRecords.count("ce-1");
      expect(key.slice(0, root.length)).toEqual(root);
    });

    it("root is a prefix of get()", () => {
      const root = queryKeys.entityRecords.root;
      const key = queryKeys.entityRecords.get("ce-1", "rec-1");
      expect(key.slice(0, root.length)).toEqual(root);
    });
  });

  describe("columnDefinitions", () => {
    it("root is a prefix of list()", () => {
      const root = queryKeys.columnDefinitions.root;
      const list = queryKeys.columnDefinitions.list();
      expect(list.slice(0, root.length)).toEqual(root);
    });

    it("root is a prefix of get()", () => {
      const root = queryKeys.columnDefinitions.root;
      const key = queryKeys.columnDefinitions.get("cd-1");
      expect(key.slice(0, root.length)).toEqual(root);
    });

    it("root is a prefix of impact()", () => {
      const root = queryKeys.columnDefinitions.root;
      const key = queryKeys.columnDefinitions.impact("cd-1");
      expect(key.slice(0, root.length)).toEqual(root);
    });
  });

  describe("jobs (for revalidation invalidation)", () => {
    it("root is a prefix of list()", () => {
      const root = queryKeys.jobs.root;
      const list = queryKeys.jobs.list();
      expect(list.slice(0, root.length)).toEqual(root);
    });

    it("root is a prefix of get()", () => {
      const root = queryKeys.jobs.root;
      const key = queryKeys.jobs.get("job-1");
      expect(key.slice(0, root.length)).toEqual(root);
    });
  });
});
