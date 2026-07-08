/**
 * Background batched prompt FTS backfill with start/pause/resume/cancel.
 * Used by WebSocketServer and search handler packets.
 */
class PromptIndexService {
    constructor(globalResources) {
        this.globalResources = globalResources;
        this.wsServer = null;
        this.state = 'idle';
        this.cancelRequested = false;
        this.pauseRequested = false;
        this.runLoopActive = false;
        this.stats = null;
        this.queueTotalAtStart = 0;
        this.sessionUpdated = 0;
        this.sessionErrors = 0;
        this.sessionSkipped = 0;
        this.currentFilename = '';
    }

    setWsServer(wsServer) {
        this.wsServer = wsServer;
    }

    isRunning() {
        return this.state === 'running';
    }

    isPaused() {
        return this.state === 'paused';
    }

    async refreshStats() {
        const metadataDb = this.globalResources.getMetadataDatabase();
        this.stats = await metadataDb.getPromptIndexStats();
        return this.stats;
    }

    buildStatusPayload(overrides = {}) {
        const stats = this.stats || {};
        const ftsPending = stats.ftsPending || 0;
        const ftsDrift = stats.ftsDrift || 0;
        const needsWork = ftsPending > 0 || ftsDrift > 0;

        let status = this.state;
        if (status === 'idle' && needsWork) {
            status = 'pending';
        }

        const remaining = ftsPending;
        const processed = this.queueTotalAtStart > 0
            ? Math.max(0, this.queueTotalAtStart - remaining)
            : 0;
        const percentage = this.queueTotalAtStart > 0
            ? Math.min(100, Math.round((processed / this.queueTotalAtStart) * 100))
            : (needsWork ? 0 : 100);

        const defaultMessage = (() => {
            if (this.state === 'running') {
                return `Prompt FTS: ${processed}/${this.queueTotalAtStart} (${percentage}%)`;
            }
            if (this.state === 'paused') {
                return 'Prompt FTS indexing paused';
            }
            if (this.state === 'cancelled') {
                return 'Prompt FTS indexing cancelled';
            }
            if (ftsDrift > 0 && ftsPending === 0) {
                return `Prompt FTS drift detected (${ftsDrift} rows need reconcile)`;
            }
            if (ftsPending > 0) {
                return `Prompt FTS backlog: ${ftsPending} images pending`;
            }
            return 'Prompt FTS index up to date';
        })();

        return {
            job: 'prompt_fts',
            status: overrides.status || status,
            message: overrides.message || defaultMessage,
            stats,
            current: processed,
            total: this.queueTotalAtStart || ftsPending,
            percentage,
            filename: this.currentFilename || '',
            updatedCount: this.sessionUpdated,
            errorCount: this.sessionErrors,
            skippedCount: this.sessionSkipped,
            paused: this.state === 'paused',
            running: this.state === 'running',
            needsWork,
            timestamp: new Date().toISOString(),
            ...overrides
        };
    }

    buildPromptFtsSnapshot(overrides = {}) {
        const payload = this.buildStatusPayload(overrides);
        const { job, type, ...snapshot } = payload;
        return snapshot;
    }

    broadcastStatus(overrides = {}) {
        if (!this.wsServer) return;
        this.wsServer.broadcast({
            type: 'search_indexing_status',
            ...this.buildStatusPayload(overrides)
        });
    }

    async start() {
        if (this.state === 'running') {
            return { ok: false, reason: 'already_running' };
        }
        if (this.state === 'paused' && this.runLoopActive) {
            return this.resume();
        }

        await this.refreshStats();
        const pending = (this.stats?.ftsPending || 0) + (this.stats?.ftsDrift || 0);
        if (pending === 0) {
            this.state = 'idle';
            this.broadcastStatus({ status: 'up_to_date', message: 'Prompt FTS index up to date' });
            return { ok: true, alreadyComplete: true };
        }

        if ((this.stats?.ftsDrift || 0) > 0) {
            const metadataDb = this.globalResources.getMetadataDatabase();
            await metadataDb.reconcilePromptFtsFlags();
            await this.refreshStats();
        }

        this.cancelRequested = false;
        this.pauseRequested = false;
        this.state = 'running';
        this.sessionUpdated = 0;
        this.sessionErrors = 0;
        this.sessionSkipped = 0;
        this.queueTotalAtStart = this.stats?.ftsPending || 0;
        this.broadcastStatus({ status: 'starting', message: 'Starting prompt FTS indexing…' });
        void this._runLoop();
        return { ok: true };
    }

    pause() {
        if (this.state !== 'running') {
            return { ok: false, reason: 'not_running' };
        }
        this.pauseRequested = true;
        return { ok: true };
    }

    resume() {
        if (this.state !== 'paused') {
            return { ok: false, reason: 'not_paused' };
        }
        this.pauseRequested = false;
        this.state = 'running';
        this.broadcastStatus({ status: 'resumed', message: 'Prompt FTS indexing resumed' });
        void this._runLoop();
        return { ok: true };
    }

    cancel() {
        if (this.state !== 'running' && this.state !== 'paused') {
            return { ok: false, reason: 'not_active' };
        }
        this.cancelRequested = true;
        this.pauseRequested = false;
        if (this.state === 'paused') {
            this.state = 'cancelled';
            this.broadcastStatus({ status: 'idle', message: 'Prompt FTS indexing cancelled' });
        }
        return { ok: true };
    }

    async reconcile() {
        const metadataDb = this.globalResources.getMetadataDatabase();
        const result = await metadataDb.reconcilePromptFtsFlags();
        await this.refreshStats();
        this.broadcastStatus({
            status: this.stats?.ftsPending > 0 ? 'pending' : 'up_to_date',
            message: result.updated > 0
                ? `Reconciled ${result.updated} prompt FTS flags`
                : 'Prompt FTS flags already consistent'
        });
        return result;
    }

    async getStatusForConnect() {
        await this.refreshStats();
        return this.buildPromptFtsSnapshot();
    }

    async _runLoop() {
        if (this.runLoopActive) return;
        this.runLoopActive = true;

        const metadataDb = this.globalResources.getMetadataDatabase();

        try {
            while (this.state === 'running' && !this.cancelRequested) {
                if (this.pauseRequested) {
                    this.state = 'paused';
                    this.broadcastStatus({ status: 'paused', message: 'Prompt FTS indexing paused' });
                    break;
                }

                const result = await metadataDb.backfillPromptFts({
                    maxBatches: 1,
                    batchSize: 500,
                    shouldAbort: () => this.cancelRequested || this.pauseRequested,
                    progressCallback: (progress) => {
                        this.currentFilename = progress.filename || '';
                    }
                });

                if (this.pauseRequested) {
                    this.state = 'paused';
                    this.broadcastStatus({ status: 'paused', message: 'Prompt FTS indexing paused' });
                    break;
                }

                if (this.cancelRequested) {
                    this.state = 'cancelled';
                    this.broadcastStatus({ status: 'idle', message: 'Prompt FTS indexing cancelled' });
                    break;
                }

                this.sessionUpdated += result.updatedCount || 0;
                this.sessionErrors += result.errorCount || 0;
                this.sessionSkipped += result.skippedCount || 0;

                await this.refreshStats();
                const remaining = this.stats?.ftsPending || 0;
                const processed = this.queueTotalAtStart > 0
                    ? Math.max(0, this.queueTotalAtStart - remaining)
                    : 0;
                const percentage = this.queueTotalAtStart > 0
                    ? Math.min(100, Math.round((processed / this.queueTotalAtStart) * 100))
                    : 100;

                this.broadcastStatus({
                    status: 'indexing',
                    message: `Prompt FTS: ${processed}/${this.queueTotalAtStart} (${percentage}%)`,
                    current: processed,
                    total: this.queueTotalAtStart,
                    percentage
                });

                if ((result.batches || 0) === 0 || remaining === 0) {
                    await metadataDb.reconcilePromptFtsFlags();
                    await this.refreshStats();
                    this.state = 'idle';
                    this.broadcastStatus({
                        status: 'complete',
                        message: `Prompt FTS indexing complete (${this.sessionUpdated} updated, ${this.sessionErrors} errors)`
                    });
                    break;
                }

                await new Promise((resolve) => setImmediate(resolve));
            }
        } catch (error) {
            console.error('❌ Prompt FTS indexing error:', error);
            this.state = 'error';
            this.broadcastStatus({
                status: 'error',
                message: `Prompt FTS indexing failed: ${error.message}`,
                error: error.message
            });
        } finally {
            this.runLoopActive = false;
            if (this.state === 'running') {
                this.state = 'idle';
            }
        }
    }
}

module.exports = { PromptIndexService };
