import { Project, type ProjectProperties } from "../domain/Project.js";

import type {
  Project as PrismaProject,
  Prisma,
} from "../../../../generated/prisma/client.js";

export const ProjectMapper = {
  toDomain(row: PrismaProject): Project {
    const props: ProjectProperties = {
      id: row.id,
      ownerUserId: row.ownerUserId,
      name: row.name,
      description: row.description,
      genre: row.genre,
      tone: row.tone,
      style: row.style,
      language: row.language,
      visibility: row.visibility,
      status: row.status,
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
    };

    return Project.reconstitute(props);
  },

  toPersistence(project: Project): Prisma.ProjectUncheckedCreateInput {
    const snapshot = project.toSnapshot();

    return {
      ownerUserId: snapshot.ownerUserId,
      name: snapshot.name,
      description: snapshot.description,
      genre: snapshot.genre,
      tone: snapshot.tone,
      style: snapshot.style,
      language: snapshot.language,
      visibility: snapshot.visibility,
      status: snapshot.status,
      createdByUserId: snapshot.createdByUserId,
      archivedAt: snapshot.archivedAt,
    };
  },
};
