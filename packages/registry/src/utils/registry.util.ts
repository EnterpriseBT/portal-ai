import { DefineRegistryResult } from "@json-render/react";
import { Catalog } from "@json-render/core";

export interface RegistryEntry<C> {
  name: C;
  definition: DefineRegistryResult;
  catalog: Catalog;
}

export class Registry<C extends string> {
  _catalogs: Map<C, RegistryEntry<C>> = new Map();

  register(entry: RegistryEntry<C>) {
    this._catalogs.set(entry.name, entry);
  }

  get(name: C): RegistryEntry<C> | null {
    return this._catalogs.get(name) ?? null;
  }
}
