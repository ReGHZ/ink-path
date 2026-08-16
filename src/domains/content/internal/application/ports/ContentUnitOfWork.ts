import type { OutboxEventRepository } from "../../../../../shared/application/ports/OutboxEventRepository.js";
import type { ContentRelationshipRepository } from "../../domain/support/ContentRelationshipRepository.js";
import type { ContentRevisionRepository } from "../../domain/support/ContentRevisionRepository.js";

export type ContentRepositories<TEntityRepo> = {
    entity: TEntityRepo;
    contentRevisions: ContentRevisionRepository;
    // Added by item 7.4b: the M:N delete guard
    // (`03-database-design/06_content_tables.md:302` + §Delete Behavior, Flow 3
    // §Delete step 5) reads `content_relationships` through the SAME client that
    // performs the delete. `content_relationships` points at entities
    // polymorphically with no FK, so the database cannot enforce the rule and no
    // P2003 will ever fire for it; this read is the only enforcement there is.
    //
    // Being inside the transaction does NOT make the guard atomic with the
    // delete — it takes no lock, and under READ COMMITTED a concurrent
    // relationship insert can still land between the check and the delete
    // (`../support/contentRelationshipDeleteGuard.ts` header, accepted risk).
    // Three things it does buy, all of them real:
    //   1. one snapshot, consistent with every other read the same transaction
    //      makes — the guard and the delete cannot disagree about the entity;
    //   2. no second pool connection taken while the first is still held (the
    //      same reason name resolution is deliberately kept OUTSIDE);
    //   3. it is where a pessimistic lock would have to go if the accepted risk
    //      is ever revisited — `FOR UPDATE` becomes one line here instead of a
    //      restructuring of all nine delete flows.
    //
    // Every one of the nine entity unit-of-works gets it, not just the two
    // services that had written the gap down
    // (`../story/CharacterService.ts`, `../world/WorldElementService.ts`): a
    // relationship endpoint may be any of the nine types, so any of the nine
    // deletes can be blocked.
    contentRelationships: ContentRelationshipRepository;
};

export type ContentUnitOfWork<TEntityRepo> = {
    transaction<T>(
        work: (
            repositories: ContentRepositories<TEntityRepo>,
            outboxEvents: OutboxEventRepository
        ) => Promise<T>,
    ): Promise<T>;
};
