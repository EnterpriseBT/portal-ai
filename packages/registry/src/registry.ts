import { Registry } from "./utils/registry.util.js";
import { BlogEntry } from "./catalogs/Blog/index.js";
import { CatalogName } from "./types.js";

export const registry = new Registry<CatalogName>();

/**
 * Register catalogs here. Each catalog should be defined in its own file under the /catalogs directory and should export a RegistryEntry that includes the catalog's name, its DefineRegistryResult, and its Catalog instance.
 */
registry.register(BlogEntry);
