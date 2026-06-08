/**
 * priority controller
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::priority.priority', ({ strapi }) => ({
  async find(ctx) {
    // Force sort by final_score desc
    ctx.query = {
      ...ctx.query,
      sort: { final_score: 'desc' },
    };

    // Call the default core action
    const response = await super.find(ctx);
    return response;
  },
}));
