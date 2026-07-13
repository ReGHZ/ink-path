import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

export type WorldElementStatus = "draft" | "published"

export type WorldElementProperties = {
    id: string;
    projectId: string;
    createdByUserId: string;
    name: string;
    description: string | null;
    category: string;
    content: string | null;
    status: WorldElementStatus;
    currentRevisionId: string;
    createdAt: Date;
    updatedAt: Date;
};

export type CreateWorldElementProperties = {
    id: string;
    projectId: string;
    createdByUserId: string;
    name: string;
    description?: string | null;
    category: string;
    content?: string | null;
    currentRevisionId: string;
    now: Date;
};

export type UpdateWorldElementDetailsProperties = {
    name?: string;
    description?: string | null;
    category?: string;
    content?: string | null;
    now: Date;
};

export class WorldElement {
    private constructor(private readonly props: WorldElementProperties) {
        WorldElement.validate(props)
    }

    static create(props: CreateWorldElementProperties): WorldElement {
        return new WorldElement({
            id: props.id,
            projectId: props.projectId,
            createdByUserId: props.createdByUserId,
            name: props.name.trim(),
            description: WorldElement.normalizeOptionalText(props.description ?? null),
            category: props.category.trim(),
            content: WorldElement.normalizeOptionalText(props.content ?? null),
            status: 'draft',
            currentRevisionId: props.currentRevisionId,
            createdAt: props.now,
            updatedAt: props.now
        })
    }

    static reconstitute(props: WorldElementProperties): WorldElement {
        return new WorldElement(props)
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

    get name(): string {
        return this.props.name;
    }

    get description(): string | null {
        return this.props.description;
    }

    get category(): string {
        return this.props.category;
    }

    get content(): string | null {
        return this.props.content;
    }

    get status(): WorldElementStatus {
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

    changeStatus(status: WorldElementStatus, now: Date): void {
        if (this.props.status === status) {
            return;
        }

        const nextProperties: WorldElementProperties = {
            ...this.props,
            status,
            updatedAt: now,
        };

        WorldElement.validate(nextProperties);

        Object.assign(this.props, nextProperties);
    }

    updateDetails(input: UpdateWorldElementDetailsProperties): void {
        const nextProperties: WorldElementProperties = {
            ...this.props,
            updatedAt: input.now
        }

        if (input.name !== undefined) {
            nextProperties.name = input.name.trim();
        }

        if (input.description !== undefined) {
            nextProperties.description = WorldElement.normalizeOptionalText(input.description);
        }

        if (input.category !== undefined) {
            nextProperties.category = input.category.trim();
        }

        if (input.content !== undefined) {
            nextProperties.content = WorldElement.normalizeOptionalText(input.content);
        }

        WorldElement.validate(nextProperties);

        Object.assign(this.props, nextProperties);
    }

    toSnapshot(): WorldElementProperties {
        return { ...this.props };
    }

    private static normalizeOptionalText(value: string | null): string | null {
        if (value === null) {
            return null;
        }

        const trimmed = value.trim();

        return trimmed === "" ? null : trimmed;
    }

    private static validate(props: WorldElementProperties): void {
        if (props.id.trim() === "") {
            throw new DomainError(
                DomainErrorCode.DOMAIN_VALIDATION_FAILED,
                "World element id is required"
            )
        }

        if (props.projectId.trim() === "") {
            throw new DomainError(
                DomainErrorCode.DOMAIN_VALIDATION_FAILED,
                "Project id is required"
            )
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
                "World element name is required",
            );
        }

        if (props.category.trim() === "") {
            throw new DomainError(
                DomainErrorCode.DOMAIN_VALIDATION_FAILED,
                "World element category is required",
            );
        }

        if (props.currentRevisionId.trim() === "") {
            throw new DomainError(
                DomainErrorCode.DOMAIN_VALIDATION_FAILED,
                "Current revision id is required",
            );

        }

        if (
            props.status === "published" &&
            WorldElement.normalizeOptionalText(props.content) === null
        ) {
            throw new DomainError(
                DomainErrorCode.DOMAIN_VALIDATION_FAILED,
                "Published World element must have content",
            );
        }
    }
}