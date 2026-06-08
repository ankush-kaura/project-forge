/**
 * Custom analyze route
 * POST /api/analyze/:ideaId - Trigger AI analysis for an idea
 */

export default {
  routes: [
    {
      method: 'POST',
      path: '/analyze/:ideaId',
      handler: 'analyze.triggerAnalysis',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
