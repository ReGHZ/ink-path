-- Split from the migration that follows it, and not for tidiness: Postgres
-- refuses to USE an enum value in the same transaction that adds it ("unsafe use
-- of new value of enum type"). The next migration writes CHECK constraints that
-- name 'terminate' and 'retract', so the values have to be committed first.

-- AlterEnum
ALTER TYPE "TransitionEffectType" ADD VALUE 'terminate';
ALTER TYPE "TransitionEffectType" ADD VALUE 'retract';
