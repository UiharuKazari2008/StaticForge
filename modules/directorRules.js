'use strict';

// Memories applet rules and feedback. The old Director chat does not use these.

async function handleDirectorSaveFeedback(handler, ws, message, clientInfo, wsServer) {
    try {
        const { select_text, replace_text, action, ai_reason, user_feedback, timestamp } = message;

        // Validate required fields
        if (!user_feedback || user_feedback.trim() === '') {
            handler.sendError(ws, 'User feedback description is required', 'VALIDATION_ERROR', message.requestId);
            return;
        }

        // Create feedback entry
        const feedbackEntry = {
            id: `feedback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            select_text: select_text || '',
            replace_text: replace_text || '',
            action: action || 'replace',
            ai_reason: ai_reason || '',
            user_feedback: user_feedback.trim(),
            timestamp: timestamp || new Date().toISOString(),
            resolved: false
        };

        handler.globalResources.modifyConfig('directorConfig').append('feedback.entries', feedbackEntry);

        console.log(`📝 Director feedback saved: ${feedbackEntry.id}`);
        console.log(`   Issue: ${user_feedback.substring(0, 100)}${user_feedback.length > 100 ? '...' : ''}`);

        const feedbackEntries = handler.globalResources.getDirectorConfig({ path: 'feedback.entries' }) || [];

        // Send success response
        handler.sendToClient(ws, {
            type: 'director_save_feedback_response',
            requestId: message.requestId,
            data: {
                success: true,
                message: 'Feedback saved successfully',
                feedbackId: feedbackEntry.id,
                totalEntries: feedbackEntries.length
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error saving director feedback:', error);
        handler.sendError(ws, 'Failed to save feedback', error.message, message.requestId);
    }
}

// Handle director rules loading

async function handleDirectorLoadRules(handler, ws, message, clientInfo, wsServer) {
    try {
        // Load current director config
        const directorConfig = handler.globalResources.getDirectorConfig();

        if (!Array.isArray(directorConfig.rules.entries)) {
            directorConfig.rules.entries = [];
        }

        console.log(`📚 Loaded ${directorConfig.rules.entries.length} director rules`);

        // Send response
        handler.sendToClient(ws, {
            type: 'director_load_rules_response',
            requestId: message.requestId,
            data: {
                success: true,
                rules: directorConfig.rules.entries
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error loading director rules:', error);
        handler.sendError(ws, 'Failed to load rules', error.message, message.requestId);
    }
}

// Handle director rules saving

async function handleDirectorSaveRules(handler, ws, message, clientInfo, wsServer) {
    try {
        const { rules } = message;

        if (!Array.isArray(rules)) {
            handler.sendError(ws, 'Rules must be an array', 'VALIDATION_ERROR', message.requestId);
            return;
        }

        handler.globalResources.modifyConfig('directorConfig').assign('rules.entries', rules);

        console.log(`📝 Director rules saved: ${rules.length} rule(s)`);

        // Send success response
        handler.sendToClient(ws, {
            type: 'director_save_rules_response',
            requestId: message.requestId,
            data: {
                success: true,
                message: 'Rules saved successfully',
                totalRules: rules.length
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error saving director rules:', error);
        handler.sendError(ws, 'Failed to save rules', error.message, message.requestId);
    }
}

// Handle director feedback loading

async function handleDirectorLoadFeedback(handler, ws, message, clientInfo, wsServer) {
    try {
        // Load current director config
        const directorConfig = handler.globalResources.getDirectorConfig();

        if (!Array.isArray(directorConfig.feedback.entries)) {
            directorConfig.feedback.entries = [];
        }

        console.log(`📚 Loaded ${directorConfig.feedback.entries.length} director feedback entries`);

        // Send response
        handler.sendToClient(ws, {
            type: 'director_load_feedback_response',
            requestId: message.requestId,
            data: {
                success: true,
                feedback: directorConfig.feedback.entries
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error loading director feedback:', error);
        handler.sendError(ws, 'Failed to load feedback', error.message, message.requestId);
    }
}

// Handle director feedback deletion

async function handleDirectorDeleteFeedback(handler, ws, message, clientInfo, wsServer) {
    try {
        const { feedbackId } = message;

        if (!feedbackId) {
            handler.sendError(ws, 'Feedback ID is required', 'VALIDATION_ERROR', message.requestId);
            return;
        }

        const feedbackEntries = handler.globalResources.getDirectorConfig({ path: 'feedback.entries' }) || [];
        if (!feedbackEntries.some(entry => entry.id === feedbackId)) {
            handler.sendError(ws, 'Feedback entry not found', 'NOT_FOUND', message.requestId);
            return;
        }

        handler.globalResources.modifyConfig('directorConfig').delete('feedback.entries', entry => entry.id === feedbackId);

        console.log(`🗑️ Director feedback deleted: ${feedbackId}`);

        const updatedEntries = handler.globalResources.getDirectorConfig({ path: 'feedback.entries' }) || [];

        // Send success response
        handler.sendToClient(ws, {
            type: 'director_delete_feedback_response',
            requestId: message.requestId,
            data: {
                success: true,
                message: 'Feedback deleted successfully',
                totalEntries: updatedEntries.length
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error deleting director feedback:', error);
        handler.sendError(ws, 'Failed to delete feedback', error.message, message.requestId);
    }
}

module.exports = {
    handleDirectorSaveFeedback,
    handleDirectorLoadRules,
    handleDirectorSaveRules,
    handleDirectorLoadFeedback,
    handleDirectorDeleteFeedback
};
