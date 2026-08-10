import { normalizeOptionalText } from "../../../../../shared/domain/normalizeOptionalText.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

export type PlotStatus = "draft" | "active" | "completed";

export type PlotProperties = {
  id: string;
  version: number;
  projectId: string;
  createdByUserId: string;
  name: string;
  description: string | null;
  theme: string | null;
  conflict: string | null;
  resolution: string | null;
  content: string | null;
  status: PlotStatus;
  currentRevisionId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CreatePlotProperties = {
  id: string;
  projectId: string;
  createdByUserId: string;
  name: string;
  description?: string | null;
  theme?: string | null;
  conflict?: string | null;
  resolution?: string | null;
  content?: string | null;
  currentRevisionId: string;
  now: Date;
};

export type UpdatePlotDetailsProperties = {
  name?: string;
  description?: string | null;
  theme?: string | null;
  conflict?: string | null;
  resolution?: string | null;
  content?: string | null;
  now: Date;
};

export class Plot {
  private constructor(private readonly props: PlotProperties) {
    Plot.validate(props);
  }

  static create(props: CreatePlotProperties): Plot {
    return new Plot({
      id: props.id,
      version: 0,
      projectId: props.projectId,
      createdByUserId: props.createdByUserId,
      name: props.name.trim(),
      description: normalizeOptionalText(props.description ?? null),
      theme: normalizeOptionalText(props.theme ?? null),
      conflict: normalizeOptionalText(props.conflict ?? null),
      resolution: normalizeOptionalText(props.resolution ?? null),
      content: normalizeOptionalText(props.content ?? null),
      status: "draft",
      currentRevisionId: props.currentRevisionId,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: PlotProperties): Plot {
    return new Plot(props);
  }

  get id(): string {
    return this.props.id;
  }

  get version(): number {
    return this.props.version;
  }

  get projectId(): string {
    return this.props.projectId;
  }

  get createdByUserId(): string {
    return this.props.createdByUserId;
  }

  get name(): string {
    return this.props.name;
  }

  get description(): string | null {
    return this.props.description;
  }

  get theme(): string | null {
    return this.props.theme;
  }

  get conflict(): string | null {
    return this.props.conflict;
  }

  get resolution(): string | null {
    return this.props.resolution;
  }

  get content(): string | null {
    return this.props.content;
  }

  get status(): PlotStatus {
    return this.props.status;
  }

  get currentRevisionId(): string {
    return this.props.currentRevisionId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  changeStatus(status: PlotStatus, now: Date): boolean {
    if (this.props.status === status) {
      return false;
    }

    const nextProperties: PlotProperties = {
      ...this.props,
      status,
      updatedAt: now,
    };

    Plot.validate(nextProperties);

    Object.assign(this.props, nextProperties);

    return true;
  }

  updateDetails(input: UpdatePlotDetailsProperties): boolean {
    const nextProperties: PlotProperties = {
      ...this.props,
    };

    let changed = false;

    if (input.name !== undefined) {
      const name = input.name.trim();

      if (name !== this.props.name) {
        nextProperties.name = name;
        changed = true;
      }
    }

    if (input.description !== undefined) {
      const description = normalizeOptionalText(input.description);

      if (description !== this.props.description) {
        nextProperties.description = description;
        changed = true;
      }
    }

    if (input.theme !== undefined) {
      const theme = normalizeOptionalText(input.theme);

      if (theme !== this.props.theme) {
        nextProperties.theme = theme;
        changed = true;
      }
    }

    if (input.conflict !== undefined) {
      const conflict = normalizeOptionalText(input.conflict);

      if (conflict !== this.props.conflict) {
        nextProperties.conflict = conflict;
        changed = true;
      }
    }

    if (input.resolution !== undefined) {
      const resolution = normalizeOptionalText(input.resolution);

      if (resolution !== this.props.resolution) {
        nextProperties.resolution = resolution;
        changed = true;
      }
    }

    if (input.content !== undefined) {
      const content = normalizeOptionalText(input.content);

      if (content !== this.props.content) {
        nextProperties.content = content;
        changed = true;
      }
    }

    if (!changed) {
      return false;
    }

    nextProperties.updatedAt = input.now;

    Plot.validate(nextProperties);

    Object.assign(this.props, nextProperties);

    return true;
  }

  toSnapshot(): PlotProperties {
    return { ...this.props };
  }

  private static validate(props: PlotProperties): void {
    if (props.id.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Plot id is required",
      );
    }

    if (!Number.isInteger(props.version) || props.version < 0) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Plot version must be a non-negative integer",
      );
    }

    if (props.projectId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Project id is required",
      );
    }

    if (props.createdByUserId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Created by user id is required",
      );
    }

    if (props.name.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Plot name is required",
      );
    }

    if (props.currentRevisionId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Current revision id is required",
      );
    }

    const validStatuses: readonly PlotStatus[] = [
      "draft",
      "active",
      "completed",
    ];

    if (!validStatuses.includes(props.status)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Invalid plot status",
      );
    }

    // Guard: non-draft (active/completed) butuh content
    // terisi — generalisasi pola WorldElement/Event "published butuh content"
    // ke 3 status. Arah transisi sengaja dibiarkan bebas: tidak ada
    // pengecekan status asal di sini, changeStatus() cuma memvalidasi status
    // akhir, sama seperti WorldElement.changeStatus().
    if (
      props.status !== "draft" &&
      normalizeOptionalText(props.content) === null
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Active or completed plot must have content",
      );
    }

    // Guard tambahan khusus completed: resolution adalah field yang maknanya
    // terikat langsung ke "bagaimana konflik diselesaikan" — plot yang
    // ditandai completed tanpa resolution tertulis dianggap invalid.
    if (
      props.status === "completed" &&
      normalizeOptionalText(props.resolution) === null
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Completed plot must have a resolution",
      );
    }
  }
}
