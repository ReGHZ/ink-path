import { normalizeOptionalText } from "../../../../../shared/domain/normalizeOptionalText.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";


export type LayerStatus = "draft" | "published" | "archived"
export type LayerExposure = "internal_only" | "character_aware" | "reader_visible"

export type LayerProperties = {
    id: string
    projectId: string
    createdByUserId: string
    parentId: string | null
    name: string
    level: number
    exposure: LayerExposure
    description: string | null
    content: string | null
    status: LayerStatus
    currentRevisionId: string
    createdAt: Date
    updatedAt: Date
}

export type CreateLayerProperties = {
    id: string;
    projectId: string;
    createdByUserId: string;
    parentId?: string | null;
    name: string;
    level: number;
    exposure: LayerExposure;
    description?: string | null;
    content?: string | null;
    currentRevisionId: string;
    now: Date;
}

export type UpdateLayerDetailProperties = {
    name?: string
    level?: number
    exposure?: LayerExposure
    description?: string | null
    content?: string | null
    now: Date
}

export class Layer {
    private constructor(private readonly props: LayerProperties) { Layer.validate(props) }

    static create(props: CreateLayerProperties): Layer {
        return new Layer({
            id: props.id,
            projectId: props.projectId,
            createdByUserId: props.createdByUserId,
            parentId: normalizeOptionalText(props.parentId ?? null),
            name: props.name.trim(),
            level: props.level,
            exposure: props.exposure,
            description: normalizeOptionalText(props.description ?? null),
            content: normalizeOptionalText(props.content ?? null),
            status: 'draft',
            currentRevisionId: props.currentRevisionId,
            createdAt: props.now,
            updatedAt: props.now
        })
    }

    static reconstitute(props: LayerProperties): Layer {
        return new Layer(props)
    }

    get id(): string {
        return this.props.id
    }

    get projectId(): string {
        return this.props.projectId
    }

    get createdByUserId(): string {
        return this.props.createdByUserId
    }

    get parentId(): string | null {
        return this.props.parentId
    }

    get name(): string {
        return this.props.name
    }

    get level(): number {
        return this.props.level
    }

    get exposure(): LayerExposure {
        return this.props.exposure
    }

    get description(): string | null {
        return this.props.description;
    }

    get content(): string | null {
        return this.props.content;
    }

    get status(): LayerStatus {
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

    changeStatus(status: LayerStatus, now: Date): boolean {
        if (this.props.status === status) {
            return false;
        }

        const nextProperties: LayerProperties = {
            ...this.props,
            status,
            updatedAt: now,
        };

        Layer.validate(nextProperties);

        Object.assign(this.props, nextProperties);

        return true;
    }

    updateDetails(input: UpdateLayerDetailProperties): boolean {
        const nextProperties: LayerProperties = {
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

        if (input.content !== undefined) {
            const content = normalizeOptionalText(input.content);

            if (content !== this.props.content) {
                nextProperties.content = content;
                changed = true;
            }
        }

        if (input.level !== undefined) {
            if (input.level !== this.props.level) {
                nextProperties.level = input.level;
                changed = true;
            }
        }

        if (input.exposure !== undefined) {
            if (input.exposure !== this.props.exposure) {
                nextProperties.exposure = input.exposure;
                changed = true;
            }
        }

        if (!changed) {
            return false;
        }

        nextProperties.updatedAt = input.now;

        Layer.validate(nextProperties);

        Object.assign(this.props, nextProperties);

        return true;
    }

    toSnapshot(): LayerProperties {
        return { ...this.props }
    }

    private static validate(props: LayerProperties): void {
        if (props.id.trim() === "") {
            throw new DomainError(
                DomainErrorCode.DOMAIN_VALIDATION_FAILED,
                "Layer id is required",
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
                "Layer name is required",
            );
        }

        if (props.level <= 0) {
            throw new DomainError(
                DomainErrorCode.DOMAIN_VALIDATION_FAILED,
                "Layer level must be greater than 0",
            );
        }

        if (props.parentId !== null && props.parentId === props.id) {
            throw new DomainError(
                DomainErrorCode.DOMAIN_VALIDATION_FAILED,
                "Layer cannot be its own parent",
            );
        }

        const validExposures: readonly LayerExposure[] = [
            "internal_only",
            "character_aware",
            "reader_visible",
        ];

        if (!validExposures.includes(props.exposure)) {
            throw new DomainError(
                DomainErrorCode.DOMAIN_VALIDATION_FAILED,
                "Invalid layer exposure",
            );
        }

        if (props.currentRevisionId.trim() === "") {
            throw new DomainError(
                DomainErrorCode.DOMAIN_VALIDATION_FAILED,
                "Current revision id is required",
            );
        }

        const validStatuses: readonly LayerStatus[] = [
            "draft",
            "published",
            "archived",
        ];

        if (!validStatuses.includes(props.status)) {
            throw new DomainError(
                DomainErrorCode.DOMAIN_VALIDATION_FAILED,
                "Invalid layer status",
            );
        }

        if (
            props.status === "published" &&
            normalizeOptionalText(props.content) === null
        ) {
            throw new DomainError(
                DomainErrorCode.DOMAIN_VALIDATION_FAILED,
                "Published layer must have content",
            );
        }

    }

}