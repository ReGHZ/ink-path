export function normalizeOptionalText(value: string | null): string | null {
    if (value === null) {
        return null;
    }

    const trimmed = value.trim();

    return trimmed === "" ? null : trimmed;
}