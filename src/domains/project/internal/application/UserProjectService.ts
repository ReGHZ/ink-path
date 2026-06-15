import { AppError } from "../../../../shared/errors/AppError.js";
import { ErrorCode } from "../../../../shared/errors/ErrorCode.js";

import type { Clock } from "../../../../shared/application/ports/Clock.js";
import type {
    ProjectAiAccess,
    ProjectRole,
    UserProject,
} from "../domain/UserProject.js";
import type { UserProjectRepository } from "../domain/UserProjectRepository.js";
import type { ProjectUnitOfWork } from "./ports/ProjectUnitOfWork.js";

export type MemberDetail = {
    id: string;
    userId: string;
    role: ProjectRole;
    canDelete: boolean;
    aiAccess: ProjectAiAccess;
    joinedAt: Date | null;
    invitedByUserId: string | null;
};

export class UserProjectService {
    constructor(
        private readonly clock: Clock,
        private readonly userProjectRepository: UserProjectRepository,
        private readonly projectUnitOfWork: ProjectUnitOfWork,
    ) { }

    async listMembers(projectId: string): Promise<MemberDetail[]> {
        const members =
            await this.userProjectRepository.findActiveByProjectId(projectId);

        return members.map((member) => this.toMember(member));
    }

    async changeMemberRole(
        projectId: string,
        userId: string,
        newRole: ProjectRole,
    ): Promise<void> {
        const now = this.clock.now();

        await this.projectUnitOfWork.transaction(async (repositories) => {
            const member =
                await repositories.userProjects.findActiveByProjectIdAndUserIdForUpdate(
                    projectId,
                    userId,
                );

            if (!member) {
                throw new AppError(ErrorCode.NOT_FOUND, "Project membership not found");
            }

            if (member.role === "writer" && newRole !== "writer") {
                const activeMembers =
                    await repositories.userProjects.findActiveByProjectId(projectId);
                const writerCount = activeMembers.filter(
                    (member) => member.role === "writer",
                ).length;

                if (writerCount <= 1) {
                    throw new AppError(
                        ErrorCode.FORBIDDEN,
                        "Cannot remove the last writer from project",
                    );
                }
            }

            member.changeRole(newRole, now);

            await repositories.userProjects.update(member);
        });
    }

    private toMember(userProject: UserProject): MemberDetail {
        return {
            id: userProject.id,
            userId: userProject.userId,
            role: userProject.role,
            canDelete: userProject.canDelete,
            aiAccess: userProject.aiAccess,
            joinedAt: userProject.joinedAt,
            invitedByUserId: userProject.invitedByUserId,
        };
    }
}

export function createUserProjectService({
    clock,
    userProjectRepository,
    projectUnitOfWork,
}: {
    clock: Clock;
    userProjectRepository: UserProjectRepository;
    projectUnitOfWork: ProjectUnitOfWork;
}): UserProjectService {
    return new UserProjectService(clock, userProjectRepository, projectUnitOfWork);
}
