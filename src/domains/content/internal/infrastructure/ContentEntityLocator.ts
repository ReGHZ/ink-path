import {
  createContentEntityDescriptors,
  type ContentEntityRepositories,
} from "./ContentEntityDescriptors.js";

import type { ContentEntityLocator } from "../application/ports/ContentEntityLocator.js";

// Second adapter over the shared descriptor table (notes K3). No entity-type
// switch of its own and no `undefined` branch, unlike the reader: `entityType`
// arrives as the narrowed `ContentEntityType` union, so the lookup is total and
// TypeScript proves it — a tenth entity type breaks the build in
// `ContentEntityDescriptors.ts`, never here at runtime.
export function createContentEntityLocator(
  dependencies: ContentEntityRepositories,
): ContentEntityLocator {
  const descriptors = createContentEntityDescriptors(dependencies);

  return {
    async locate({ entityType, entityId }) {
      return descriptors[entityType].locate(entityId);
    },
  };
}
