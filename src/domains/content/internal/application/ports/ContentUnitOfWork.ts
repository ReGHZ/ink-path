import type { ContentRevisionRepository } from "../../domain/support/ContentRevisionRepository.js";

export type ContentRepositories<TEntityRepo> = {
    entity: TEntityRepo;
    contentRevisions: ContentRevisionRepository;
};

export type ContentUnitOfWork<TEntityRepo> = {
    transaction<T>(
        work: (repositories: ContentRepositories<TEntityRepo>) => Promise<T>,
    ): Promise<T>;
};
