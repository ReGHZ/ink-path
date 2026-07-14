import { normalizeOptionalText } from "../../../../../shared/domain/normalizeOptionalText.js";
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
            description: normalizeOptionalText(props.description ?? null),
            category: props.category.trim(),
            content: normalizeOptionalText(props.content ?? null),
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

    changeStatus(status: WorldElementStatus, now: Date): boolean {
        if (this.props.status === status) {
            return false;
        }

        const nextProperties: WorldElementProperties = {
            ...this.props,
            status,
            updatedAt: now,
        };

        WorldElement.validate(nextProperties);

        Object.assign(this.props, nextProperties);

        return true;
    }

    updateDetails(input: UpdateWorldElementDetailsProperties): boolean {
        const nextProperties: WorldElementProperties = {
            ...this.props,
        }

        let changed = false

        if (input.name !== undefined) {
            const name = input.name.trim();

            if (name !== this.props.name) {
                nextProperties.name = name
                changed = true
            }
        }

        if (input.description !== undefined) {
            const description = normalizeOptionalText(input.description);

            if (description !== this.props.description) {
                nextProperties.description = description
                changed = true
            }
        }

        if (input.category !== undefined) {
            const category = input.category.trim();

            if (category !== this.props.category) {
                nextProperties.category = category
                changed = true
            }
        }

        if (input.content !== undefined) {
            const content = normalizeOptionalText(input.content);

            if (content !== this.props.content) {
                nextProperties.content = content
                changed = true
            }
        }

        if (!changed) {
            return false
        }

        nextProperties.updatedAt = input.now

        WorldElement.validate(nextProperties);

        Object.assign(this.props, nextProperties);

        return true
    }

    toSnapshot(): WorldElementProperties {
        return { ...this.props };
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

        const validStatuses: readonly WorldElementStatus[] = [
            "draft",
            "published",
        ];

        if (!validStatuses.includes(props.status)) {
            throw new DomainError(
                DomainErrorCode.DOMAIN_VALIDATION_FAILED,
                "Invalid world element status",
            );
        }

        if (
            props.status === "published" &&
            normalizeOptionalText(props.content) === null
        ) {
            throw new DomainError(
                DomainErrorCode.DOMAIN_VALIDATION_FAILED,
                "Published world element must have content",
            );
        }
    }
}