import {
  createContentEntityDescriptors,
  type ContentEntityDescriptor,
  type ContentEntityRepositories,
} from "./ContentEntityDescriptors.js";

import type { ContentEntityReader } from "../../../../shared/application/ports/ContentEntityReader.js";

export function createContentEntityReader(
  dependencies: ContentEntityRepositories,
): ContentEntityReader {
  const descriptors = createContentEntityDescriptors(dependencies);

  return {
    async read({ entityType, entityId }) {
      // The descriptor table is keyed by the `ContentEntityType` union, but this
      // port deliberately accepts a raw string: its caller deserializes wire
      // events, where an entity type this build has never heard of is a real
      // condition to report rather than a type error to prevent (see the port's
      // own comment). Widening once, here, keeps that lookup honest — the
      // `undefined` branch below is the actual check, not a formality.
      const byType: Readonly<
        Record<string, ContentEntityDescriptor | undefined>
      > = descriptors;
      const descriptor = byType[entityType];

      if (!descriptor) {
        throw new Error(
          `No ContentEntityReader descriptor for entity type "${entityType}" — either an unsupported entity type or a Phase 6 entity type not yet wired in.`,
        );
      }

      return descriptor.read(entityId);
    },
  };
}
