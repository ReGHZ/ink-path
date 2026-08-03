-- CreateIndex
CREATE INDEX "outbox_events_status_locked_at_idx" ON "outbox_events"("status", "locked_at");
