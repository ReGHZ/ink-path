import type { PrismaClient } from "../../generated/prisma/client.js";
import type { ContentEntityType } from "../../generated/prisma/enums.js";
import type {
  AiUsageLogWriter,
  BeginAiUsageLogInput,
  CompleteAiUsageLogInput,
} from "../../shared/application/ports/AiUsageLogWriter.js";

export class PrismaAiUsageLogWriter implements AiUsageLogWriter {
  constructor(private readonly prisma: PrismaClient) {}

  async begin(input: BeginAiUsageLogInput): Promise<string> {
    const row = await this.prisma.aiUsageLog.create({
      data: {
        projectId: input.projectId,
        triggeredByUserId: input.triggeredByUserId,
        purpose: "embedding",
        provider: input.provider,
        model: input.model,
        operationType: "embedding",
        status: "in_progress",
        contentRevisionId: input.contentRevisionId,
        contextEntityType: input.contextEntityType as ContentEntityType,
        contextEntityId: input.contextEntityId,
        startedAt: input.startedAt,
      },
      select: { id: true },
    });

    return row.id;
  }

  async complete(id: string, input: CompleteAiUsageLogInput): Promise<void> {
    await this.prisma.aiUsageLog.update({
      where: { id },
      data: {
        status: input.status,
        completedAt: input.completedAt,
        latencyMs: input.latencyMs,
        errorMessage: input.status === "failed" ? input.errorMessage : null,
      },
    });
  }
}

export function createPrismaAiUsageLogWriter({
  prisma,
}: {
  prisma: PrismaClient;
}): AiUsageLogWriter {
  return new PrismaAiUsageLogWriter(prisma);
}
