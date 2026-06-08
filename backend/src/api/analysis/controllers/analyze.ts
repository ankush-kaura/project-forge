/**
 * Custom analyze controller
 * Handles AI analysis requests for ideas
 */

import type { Core } from '@strapi/strapi';

export default {
  /**
   * POST /api/analyze/:ideaId
   * Triggers AI analysis for the specified idea
   * Placeholder implementation - will later call AI CLI
   */
  async triggerAnalysis(ctx) {
    const { ideaId } = ctx.params;

    // Placeholder response - will be replaced with actual AI CLI integration
    return {
      data: {
        message: `Analysis triggered for idea ${ideaId}`,
        ideaId,
        status: 'pending',
        timestamp: new Date().toISOString(),
      },
    };
  },
};
