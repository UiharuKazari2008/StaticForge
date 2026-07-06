/**
 * Client-side mirror of server WS dispatch policy (modules/ws/wsMessageDispatcher.js).
 * Keep in sync with FIFO registrations in modules/ws/handlers/*Handler.js.
 */

const WS_FIFO_PACKET_TYPES = new Set([
    // 60-generationHandler.js — GENERATION_DESTRUCTIVE + cancel_generation
    'generate_image',
    'reroll_image',
    'upscale_image',
    'expand_image',
    'preview_expand_image_prompt',
    'reroll_expanded_image',
    'cancel_generation',
    'compile_dynamic_generation',
    'apply_tendai_preview',
    'resolve_text_replacements',
    // 90-workspaceHandler.js — WORKSPACE_DESTRUCTIVE
    'workspace_create',
    'workspace_rename',
    'workspace_delete',
    'workspace_move_files',
    'workspace_add_scrap',
    'workspace_remove_scrap',
    'workspace_add_pinned',
    'workspace_remove_pinned',
    'workspace_bulk_pinned',
    'workspace_bulk_remove_pinned',
    'workspace_create_group',
    'workspace_rename_group',
    'workspace_add_images_to_group',
    'workspace_remove_images_from_group',
    'workspace_delete_group',
    'workspace_update_color',
    'workspace_update_background_color',
    'workspace_update_settings',
    'workspace_update_primary_font',
    'workspace_update_textarea_font',
    'workspace_reorder',
    'workspace_bulk_add_scrap',
    'workspace_bulk_add_pinned'
]);

function getWsDispatchPolicy(type) {
    return WS_FIFO_PACKET_TYPES.has(String(type || '')) ? 'fifo' : 'parallel';
}

function isWsFifoDispatch(type) {
    return getWsDispatchPolicy(type) === 'fifo';
}

function buildFifoQueueIndex(activeRequests) {
    const fifoPending = (activeRequests || [])
        .filter((req) => req.isPending && isWsFifoDispatch(req.type))
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    const byId = new Map();
    fifoPending.forEach((req, index) => {
        byId.set(req.id, {
            position: index + 1,
            total: fifoPending.length
        });
    });
    return byId;
}

function formatWsDispatchBadge(type, queueInfo) {
    if (!isWsFifoDispatch(type)) {
        return '';
    }

    const position = queueInfo && queueInfo.position > 0 ? queueInfo.position : 1;
    const total = queueInfo && queueInfo.total > 0 ? queueInfo.total : 1;
    let title = 'FIFO — server runs this in session order';
    if (total > 1 && position > 1) {
        title += ` (queued #${position} of ${total})`;
    } else if (total > 1) {
        title += ` (${total} in FIFO chain)`;
    }

    const positionMarkup = total > 1 && position > 1
        ? `<span class="request-fifo-position">${position}</span>`
        : '';

    return `<span class="request-dispatch-badge request-dispatch-fifo" title="${title.replace(/"/g, '&quot;')}"><i class="fas fa-list-ol" aria-hidden="true"></i>${positionMarkup}</span>`;
}
