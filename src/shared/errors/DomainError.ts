import type { DomainErrorCode } from "./DomainErrorCode.js";

export class DomainError extends Error {
    constructor(
        public readonly code: DomainErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "DomainError";
    }
}
