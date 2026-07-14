import { normalizeOptionalText } from "../../../../../shared/domain/normalizeOptionalText.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

export type WorldMapStatus = "draft" | "published";

export type WorldMapProperties = {
    id: string;
    projectId: string;
    createdByUserId: string;
    parentId: string | null;
    name: string;
    scale: string | null;
    terrain: string | null;
    environment: string | null;
    description: string | null;
    content: string | null;
    status: WorldMapStatus;
    currentRevisionId: string;
    createdAt: Date;
    updatedAt: Date;
};

export type CreateWorldMapProperties = {
    id: string;
    projectId: string;
    createdByUserId: string;
    parentId?: string | null;
    name: string;
    scale?: string | null;
    terrain?: string | null;
    environment?: string | null;
    description?: string | null;
    content?: string | null;
    currentRevisionId: string;
    now: Date;
};

export type UpdateWorldMapDetailsProperties = {
    name?: string;
    scale?: string | null;
    terrain?: string | null;
    environment?: string | null;
    description?: string | null;
    content?: string | null;
    now: Date;
};

export class WorldMap {
    private constructor(private readonly props: WorldMapProperties) {
        WorldMap.validate(props)
    }

    static create(props: CreateWorldMapProperties): WorldMap {
        return new WorldMap({
            id: props.id,
            projectId: props.projectId,
            createdByUserId: props.createdByUserId,
            parentId: normalizeOptionalText(props.parentId ?? null),
            name: props.name.trim(),
            scale: normalizeOptionalText(props.scale ?? null),
            terrain: normalizeOptionalText(props.terrain ?? null),
            environment: normalizeOptionalText(props.environment ?? null),
            description: normalizeOptionalText(props.description ?? null),
            content: normalizeOptionalText(props.content ?? null),
            status: 'draft',
            currentRevisionId: props.currentRevisionId,
            createdAt: props.now,
            updatedAt: props.now
        })
    }

    static reconstitute(props: WorldMapProperties): WorldMap {
        return new WorldMap(props)
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

    get scale(): string | null {
        return this.props.scale
    }

    get terrain(): string | null {
        return this.props.terrain
    }

    get environment(): string | null {
        return this.props.environment
    }

    get description(): string | null {
        return this.props.description
    }

    get content(): string | null {
        return this.props.content
    }

    get status(): WorldMapStatus {
        return this.props.status
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

    changeStatus(status: WorldMapStatus, now: Date): boolean {
        if (this.props.status === status) {
            return false
        }

        const nextProperties: WorldMapProperties = {
            ...this.props,
            status,
            updatedAt: now
        }

        WorldMap.validate(nextProperties)

        Object.assign(this.props, nextProperties)

        return true
    }

    updateDetails(input: UpdateWorldMapDetailsProperties): boolean {
        const nextProperties: WorldMapProperties = {
            ...this.props
        }

        let changed = false

        if (input.name !== undefined) {
            const name = input.name.trim();

            if (name !== this.props.name) {
                nextProperties.name = name;
                changed = true;
            }
        }

        if (input.scale !== undefined) {
            const scale = normalizeOptionalText(input.scale);

            if (scale !== this.props.scale) {
                nextProperties.scale = scale;
                changed = true;
            }
        }

        if (input.terrain !== undefined) {
            const terrain = normalizeOptionalText(input.terrain);

            if (terrain !== this.props.terrain) {
                nextProperties.terrain = terrain;
                changed = true;
            }
        }

        if (input.environment !== undefined) {
            const environment = normalizeOptionalText(input.environment);

            if (environment !== this.props.environment) {
                nextProperties.environment = environment;
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

        if (!changed) {
            return false
        }

        nextProperties.updatedAt = input.now

        WorldMap.validate(nextProperties)

        Object.assign(this.props, nextProperties)

        return true
    }

    toSnapshot(): WorldMapProperties {
        return { ...this.props }
    }

    private static validate(props: WorldMapProperties): void {
        if (props.id.trim() === "") {
            throw new DomainError(
                DomainErrorCode.DOMAIN_VALIDATION_FAILED,
                "Map id is required",
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
                "Map name is required",
            );
        }

        if (props.parentId !== null && props.parentId === props.id) {
            throw new DomainError(
                DomainErrorCode.DOMAIN_VALIDATION_FAILED,
                "Map cannot be its own parent",
            );
        }

        const validStatuses: readonly WorldMapStatus[] = [
            "draft",
            "published",
        ];

        if (!validStatuses.includes(props.status)) {
            throw new DomainError(
                DomainErrorCode.DOMAIN_VALIDATION_FAILED,
                "Invalid map status",
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
            normalizeOptionalText(props.content) === null
        ) {
            throw new DomainError(
                DomainErrorCode.DOMAIN_VALIDATION_FAILED,
                "Published map must have content",
            );
        }

    }

}