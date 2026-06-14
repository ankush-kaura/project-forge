// @ts-nocheck
import type { Core } from '@strapi/strapi';
import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { callLLMJson, llmConfigured, llmInfo } from './lib/llm';
import { createRepoAndPush, githubConfigured, githubConfigStatus, sanitizeRepoName } from './lib/github';
import { writeFiles as writeWorkspaceFiles, readAllFiles, verifyTypeScript, workspaceFor } from './lib/verify';
import { requestDeploy, subdomainFor, DEPLOY_ENABLED } from './lib/deploy';

function parseBody(ctx) {
  return new Promise((resolve) => {
    let body = '';
    ctx.req.on('data', chunk => body += chunk);
    ctx.req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

async function analyzeWithLLM(prompt, task = 'analysis', opts = {}) {
  return await callLLMJson(prompt, { task, ...opts });
}

async function generateWithLLM(prompt, task = 'codegen', timeoutMs = 300000) {
  return await callLLMJson(prompt, { task, timeoutMs });
}

// Strict JSON Schema for idea analysis. Codex (Responses API) requires
// additionalProperties:false with every field listed in `required`.
const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    problem_statement: { type: 'string' },
    target_audience: { type: 'string' },
    business_model: { type: 'string' },
    revenue_potential: { type: 'string', enum: ['low', 'medium', 'high'] },
    technical_complexity: { type: 'string', enum: ['low', 'medium', 'high'] },
    dev_effort_hours: { type: 'integer' },
    risk_assessment: { type: 'string' },
    market_opportunity: { type: 'string' },
    viability_score: { type: 'integer' },
  },
  required: [
    'problem_statement', 'target_audience', 'business_model', 'revenue_potential',
    'technical_complexity', 'dev_effort_hours', 'risk_assessment', 'market_opportunity',
    'viability_score',
  ],
};

function generateMockAnalysis(idea) {
  const title = idea.title || 'Untitled Idea';
  return {
    problem_statement: `Users currently lack an efficient solution for ${title}. Existing alternatives are fragmented and require multiple tools.`,
    target_audience: `Small to medium-sized businesses, individual developers, and startup teams aged 25-45.`,
    business_model: 'SaaS freemium model. Free tier for individuals, Pro at $29/mo for teams, Enterprise with custom pricing.',
    revenue_potential: 'medium',
    technical_complexity: 'medium',
    dev_effort_hours: 480,
    risk_assessment: 'Moderate risk. Start with MVP, iterate based on feedback, focus on niche segment first.',
    market_opportunity: `Market growing at 15-20% YoY, estimated $2-5B globally. Strong demand for integrated AI-powered tools.`,
    viability_score: 72,
    raw_ai_output: JSON.stringify({ note: 'Mock analysis', idea_title: title, generated_at: new Date().toISOString() }),
  };
}

function generateMockArchitecture(idea, analysis) {
  const title = idea.title || 'Untitled';
  return {
    options: [
      {
        id: 'opt-1',
        name: 'Monolith + Next.js',
        description: `Full-stack Next.js application for ${title}. Single codebase, server-side rendering, API routes, and PostgreSQL. Best for fast iteration and small teams.`,
        stack: ['Next.js 14', 'TypeScript', 'PostgreSQL', 'Prisma', 'NextAuth.js', 'Tailwind CSS', 'ShadCN/UI', 'Vercel'],
        pros: ['Fast to build and deploy', 'Single codebase simplifies development', 'Built-in SSR/SSG for SEO', 'Rich ecosystem and community', 'Easy team onboarding'],
        cons: ['Harder to scale individual services', 'Frontend/backend coupling', 'Build times grow with project size'],
        estimated_hours: 160,
        best_for: 'MVPs, small teams, content-heavy apps, SaaS products'
      },
      {
        id: 'opt-2',
        name: 'React SPA + Express API',
        description: `Separate React frontend with Express.js REST API backend for ${title}. Decoupled architecture with clear API boundaries.`,
        stack: ['React 18', 'Vite', 'TypeScript', 'Express.js', 'PostgreSQL', 'Prisma', 'JWT Auth', 'Docker'],
        pros: ['Clear separation of concerns', 'Independent scaling of frontend/backend', 'Flexible API for multiple clients', 'Better for team分工'],
        cons: ['More infrastructure to manage', 'CORS configuration needed', 'Slower initial setup'],
        estimated_hours: 200,
        best_for: 'Multi-client apps, teams with separate frontend/backend developers'
      },
      {
        id: 'opt-3',
        name: 'Full-Stack + Microservices',
        description: `Microservices architecture for ${title}. Separate services for core domains, event-driven communication, containerized deployment.`,
        stack: ['React', 'Node.js', 'Express', 'PostgreSQL', 'Redis', 'RabbitMQ', 'Docker', 'Kubernetes'],
        pros: ['Independent service scaling', 'Technology flexibility per service', 'Fault isolation', 'Best for large teams'],
        cons: ['Significant operational complexity', 'Harder to debug distributed systems', 'Slower development velocity initially'],
        estimated_hours: 320,
        best_for: 'Enterprise apps, high-scale products, large engineering teams'
      }
    ]
  };
}

function generateMockQuestions(idea, architecture) {
  return {
    questions: [
      { question_text: 'What is the primary layout style you prefer?', question_type: 'single_choice', options: ['Dashboard-style (sidebar + main content)', 'Feed-style (scrolling timeline)', 'Landing page (sections stacked vertically)', 'App-shell (tab-based navigation)'], context: 'This determines the overall page structure and navigation pattern.' },
      { question_text: 'What authentication method do you want?', question_type: 'single_choice', options: ['Email/Password', 'Google OAuth', 'GitHub OAuth', 'Magic Link (email)', 'Multiple methods'], context: 'This affects user onboarding flow and security implementation.' },
      { question_text: 'Which features are must-have for MVP?', question_type: 'multiple_choice', options: ['User registration/login', 'CRUD operations', 'Search/filtering', 'File uploads', 'Real-time updates', 'Email notifications', 'Admin dashboard', 'Analytics'], context: 'Helps scope the initial build to essential features only.' },
      { question_text: 'What is your expected user scale in the first 6 months?', question_type: 'single_choice', options: ['< 100 users', '100-1,000 users', '1,000-10,000 users', '10,000+ users'], context: 'Affects infrastructure decisions and optimization priorities.' },
      { question_text: 'Do you need mobile responsiveness or a native mobile app?', question_type: 'single_choice', options: ['Responsive web only', 'Progressive Web App (PWA)', 'Native mobile app later', 'Both web and native from start'], context: 'Determines frontend architecture and testing strategy.' },
      { question_text: 'What payment integration do you need?', question_type: 'single_choice', options: ['None for now', 'Stripe', 'Razorpay', 'PayPal', 'Multiple gateways'], context: 'Affects checkout flow, subscription management, and webhook handling.' },
      { question_text: 'What design style do you prefer?', question_type: 'single_choice', options: ['Minimal/Clean', 'Playful/Colorful', 'Professional/Enterprise', 'Dark mode first'], context: 'Guides the UI component library and styling approach.' },
      { question_text: 'Do you need an admin panel?', question_type: 'boolean', options: ['Yes', 'No'], context: 'Admin panels add significant scope but are essential for content/user management.' },
      { question_text: 'What notification channels do you need?', question_type: 'multiple_choice', options: ['In-app notifications', 'Email notifications', 'SMS notifications', 'Push notifications', 'None for MVP'], context: 'Each channel adds complexity but improves user engagement.' },
      { question_text: 'Any specific third-party integrations needed?', question_type: 'text', options: [], context: 'List any APIs, services, or tools that must be integrated (e.g., Google Maps, Twilio, SendGrid).' }
    ]
  };
}

// Build layer prompt templates
const LAYER_PROMPTS = {
  database_schema: (idea, analysis, architecture, answers) => `Generate a complete database schema for this project.

Project: ${idea.title}
Description: ${idea.description}
Architecture: ${architecture.name}
Stack: ${architecture.stack.join(', ')}
Requirements: ${JSON.stringify(answers)}

Generate a Prisma schema with all necessary models, relations, enums, and indexes.
Also generate a seed script with sample data.

Return JSON:
{
  "files": [
    {"path": "prisma/schema.prisma", "content": "..."},
    {"path": "prisma/seed.ts", "content": "..."}
  ],
  "description": "What was generated and key design decisions"
}`,

  api_backend: (idea, analysis, architecture, answers, prevLayers) => `Generate the backend API for this project.

Project: ${idea.title}
Description: ${idea.description}
Stack: ${architecture.stack.join(', ')}
Database Schema:
${prevLayers.database_schema || 'Not yet generated'}

Requirements: ${JSON.stringify(answers)}

Generate Express.js API with:
- Route handlers for all CRUD operations
- Middleware (auth, validation, error handling)
- Service layer with business logic
- Input validation with Zod schemas
- Database access via Prisma

Return JSON with files array.`,

  frontend: (idea, analysis, architecture, answers, prevLayers) => `Generate the React frontend for this project.

Project: ${idea.title}
Description: ${idea.description}
Stack: ${architecture.stack.join(', ')}
API Endpoints: ${prevLayers.api_backend ? 'See backend layer' : 'Not yet generated'}

Requirements: ${JSON.stringify(answers)}

Generate:
- Page components with React Router
- Shared components (Layout, Navbar, Footer)
- API client with fetch/axios
- Forms with React Hook Form + Zod
- Tailwind CSS + ShadCN/UI styling
- State management with Zustand

Return JSON with files array.`,

  auth: (idea, analysis, architecture, answers) => `Generate authentication system for this project.

Project: ${idea.title}
Stack: ${architecture.stack.join(', ')}
Auth Method: ${answers.authentication || 'Email/Password'}

Generate:
- Auth configuration
- Login/Register pages
- Protected route middleware
- Session/token management
- Password hashing with bcrypt

Return JSON with files array.`,

  docker: (idea, analysis, architecture) => `Generate Docker configuration for this project.

Project: ${idea.title}
Stack: ${architecture.stack.join(', ')}

Generate:
- Dockerfile (multi-stage build)
- docker-compose.yml (dev)
- docker-compose.prod.yml
- .dockerignore
- nginx.conf for frontend

Return JSON with files array.`,

  tests: (idea, analysis, architecture, answers, prevLayers) => `Generate tests for this project.

Project: ${idea.title}
Stack: ${architecture.stack.join(', ')}
Generated Code: ${Object.keys(prevLayers).join(', ')}

Generate:
- Unit tests for services/utilities (Vitest)
- Integration tests for API routes (supertest)
- Component tests (React Testing Library)
- Test fixtures/factories

Return JSON with files array.`,

  docs: (idea, analysis, architecture, answers) => `Generate documentation for this project.

Project: ${idea.title}
Description: ${idea.description}
Stack: ${architecture.stack.join(', ')}
Business Model: ${analysis?.business_model || 'N/A'}

Generate:
- README.md (setup, usage, deployment, env vars)
- API documentation (markdown)
- CONTRIBUTING.md
- docs/ARCHITECTURE.md

Return JSON with files array.`
};

export default {
  register({ strapi }: { strapi: Core.Strapi }) {
    strapi.server.use(async (ctx, next) => {
      const { method, path } = ctx;

      // =====================================================================
      // EXISTING ROUTES (unchanged)
      // =====================================================================

      // POST /api/ideas/:id/analyze
      if (method === 'POST' && /^\/api\/ideas\/([^/]+)\/analyze$/.test(path)) {
        const id = path.match(/^\/api\/ideas\/([^/]+)\/analyze$/)[1];
        const idea = await strapi.documents('api::idea.idea').findOne({ documentId: id, populate: ['analysis'] });
        if (!idea) { ctx.status = 404; ctx.body = { error: 'Idea not found' }; return; }
        if (idea.analysis) { ctx.status = 400; ctx.body = { error: 'Already analyzed' }; return; }

        await strapi.documents('api::idea.idea').update({ documentId: id, data: { status: 'analyzing' } });
        try { await strapi.documents('api::idea.idea').publish({ documentId: id }); } catch {}

        const prompt = `Analyze this startup idea. Return JSON: problem_statement, target_audience, business_model, revenue_potential(low/medium/high), technical_complexity(low/medium/high), dev_effort_hours(int), risk_assessment, market_opportunity, viability_score(0-100).\n\nTitle: ${idea.title}\nDesc: ${idea.description}\nCategory: ${idea.category || 'other'}`;

        let data;
        try {
          data = await analyzeWithLLM(prompt, 'analysis', { schema: ANALYSIS_SCHEMA });
          if (!data || typeof data !== 'object' || !data.problem_statement) {
            throw new Error('LLM analysis returned invalid shape (missing problem_statement)');
          }
        } catch (err) {
          if (process.env.MOCK_MODE === '1') {
            data = generateMockAnalysis(idea);
          } else {
            await strapi.documents('api::idea.idea').update({ documentId: id, data: { status: 'captured' } });
            try { await strapi.documents('api::idea.idea').publish({ documentId: id }); } catch {}
            ctx.status = 502; ctx.body = { error: 'LLM failed', detail: String(err?.message || err) };
            return;
          }
        }
        const validLevels = ['low', 'medium', 'high'];
        if (!validLevels.includes(data.revenue_potential)) data.revenue_potential = 'medium';
        if (!validLevels.includes(data.technical_complexity)) data.technical_complexity = 'medium';
        data.viability_score = Math.max(0, Math.min(100, parseInt(data.viability_score) || 50));
        data.dev_effort_hours = parseInt(data.dev_effort_hours) || 400;
        data.raw_ai_output = data.raw_ai_output || JSON.stringify(data);

        const analysis = await strapi.documents('api::analysis.analysis').create({ data: { ...data, idea: id } });
        await strapi.documents('api::idea.idea').update({ documentId: id, data: { status: 'analyzed', analysis: analysis.documentId } });
        try { await strapi.documents('api::idea.idea').publish({ documentId: id }); } catch {}

        ctx.body = { data: { message: `Analysis completed for "${idea.title}"`, analysis } };
        return;
      }

      // POST /api/ideas/:id/prioritize
      if (method === 'POST' && /^\/api\/ideas\/([^/]+)\/prioritize$/.test(path)) {
        const id = path.match(/^\/api\/ideas\/([^/]+)\/prioritize$/)[1];
        const body = await parseBody(ctx);
        const { revenue_score, interest_score, opportunity_score, complexity_score } = body;

        if (!revenue_score || !interest_score || !opportunity_score || !complexity_score) {
          ctx.status = 400; ctx.body = { error: 'All scores required (1-10)' }; return;
        }

        const idea = await strapi.documents('api::idea.idea').findOne({ documentId: id, populate: ['priority'] });
        if (!idea) { ctx.status = 404; ctx.body = { error: 'Idea not found' }; return; }

        const final_score = Math.round((((revenue_score + interest_score + opportunity_score) / 3) / complexity_score * 10) * 10) / 10;
        const scoreData = { revenue_score, interest_score, opportunity_score, complexity_score, final_score };

        let priority;
        if (idea.priority) {
          priority = await strapi.documents('api::priority.priority').update({ documentId: idea.priority.documentId, data: scoreData });
        } else {
          priority = await strapi.documents('api::priority.priority').create({ data: { ...scoreData, idea: id } });
        }

        await strapi.documents('api::idea.idea').update({ documentId: id, data: { status: 'prioritized', priority: priority.documentId } });
        try { await strapi.documents('api::idea.idea').publish({ documentId: id }); } catch {}

        const all = await strapi.documents('api::priority.priority').findMany({ sort: { final_score: 'desc' } });
        let rank = 1;
        for (let i = 0; i < all.length; i++) {
          if (i > 0 && all[i].final_score < all[i-1].final_score) rank = i + 1;
          await strapi.documents('api::priority.priority').update({ documentId: all[i].documentId, data: { rank } });
        }

        ctx.body = { data: { message: `Priority set for "${idea.title}"`, final_score, rank } };
        return;
      }

      // POST /api/ideas/:id/generate-repo
      if (method === 'POST' && /^\/api\/ideas\/([^/]+)\/generate-repo$/.test(path)) {
        const id = path.match(/^\/api\/ideas\/([^/]+)\/generate-repo$/)[1];
        const idea = await strapi.documents('api::idea.idea').findOne({ documentId: id, populate: ['repo'] });
        if (!idea) { ctx.status = 404; ctx.body = { error: 'Idea not found' }; return; }
        if (idea.repo) { ctx.status = 400; ctx.body = { error: 'Repo already generated' }; return; }

        const repoName = sanitizeRepoName(idea.title);
        let repoUrl = `https://github.com/project-forge/${repoName}`;
        let githubCreated = false;
        if (!githubConfigured()) {
          ctx.status = 503;
          ctx.body = { error: 'GitHub repo creation not configured', detail: githubConfigStatus().reason };
          return;
        }
        try {
          const readme = `# ${idea.title}\n\n${idea.description || ''}\n\n> Scaffolded by Project Forge.\n`;
          const result = await createRepoAndPush({
            name: repoName,
            description: idea.description,
            private: true,
            files: [{ path: 'README.md', content: readme }],
            commitMessage: 'Initial scaffold — generated by Project Forge',
          });
          repoUrl = result.html_url;
          githubCreated = true;
        } catch (err) {
          ctx.status = 502; ctx.body = { error: 'GitHub repo creation failed', detail: String(err?.message || err) };
          return;
        }

        const http = require('http');
        const repoPayload = JSON.stringify({ data: { repo_name: repoName, repo_url: repoUrl, visibility: 'private', github_created: githubCreated } });
        const repoResult = await new Promise((resolve, reject) => {
          const req = http.request({ hostname: '127.0.0.1', port: 1337, path: '/api/repos', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(repoPayload) } }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
          });
          req.on('error', reject);
          req.write(repoPayload);
          req.end();
        });
        const repoDocId = repoResult?.data?.documentId;

        await strapi.documents('api::idea.idea').update({ documentId: id, data: { status: 'building', repo: repoDocId } });
        try { await strapi.documents('api::idea.idea').publish({ documentId: id }); } catch {}

        ctx.body = { data: { message: `Repo generated for "${idea.title}"`, repo_name: repoName, repo_url: repoUrl } };
        return;
      }

      // =====================================================================
      // BRAINSTORM ROUTES (v2)
      // =====================================================================

      // POST /api/brainstorm/:ideaId — Trigger brainstorm
      if (method === 'POST' && /^\/api\/brainstorm\/([^/]+)$/.test(path) && !path.includes('/questions') && !path.includes('/approve') && !path.includes('/choose') && !path.includes('/layers')) {
        const ideaId = path.match(/^\/api\/brainstorm\/([^/]+)$/)[1];

        const idea = await strapi.documents('api::idea.idea').findOne({ documentId: ideaId, populate: ['analysis', 'brainstorm_sessions'] });
        if (!idea) { ctx.status = 404; ctx.body = { error: 'Idea not found' }; return; }

        // Check for existing active session
        if (idea.brainstorm_sessions && idea.brainstorm_sessions.length > 0) {
          const activeSession = idea.brainstorm_sessions.find(s => s.status !== 'completed' && s.status !== 'failed');
          if (activeSession) {
            ctx.body = { data: { message: 'Active brainstorm session already exists', session: activeSession } };
            return;
          }
        }

        // Create session
        const session = await strapi.documents('api::brainstorm-session.brainstorm-session').create({
          data: {
            idea: ideaId,
            status: 'brainstorming',
            build_progress: 0,
            iteration_count: 0,
            human_approval_stage: 'none'
          }
        });

        // Generate architecture proposal via AI
        const analysisData = idea.analysis || null;
        const prompt = `Analyze this startup idea and propose 2-3 architecture options with clear trade-offs.

Title: ${idea.title}
Description: ${idea.description}
Category: ${idea.category || 'other'}
${analysisData ? `Problem: ${analysisData.problem_statement}\nTarget Audience: ${analysisData.target_audience}\nComplexity: ${analysisData.technical_complexity}` : ''}

For each option provide: id, name, description, stack (array), pros (array), cons (array), estimated_hours (int), best_for (string).

Return JSON: { "options": [...] }`;

        let architectureProposal;
        try {
          architectureProposal = await analyzeWithLLM(prompt, 'analysis');
          if (!architectureProposal || !Array.isArray(architectureProposal.options) || architectureProposal.options.length === 0) {
            throw new Error('LLM architecture returned invalid shape (missing options[])');
          }
        } catch (err) {
          if (process.env.MOCK_MODE === '1') {
            architectureProposal = generateMockArchitecture(idea, analysisData);
          } else {
            await strapi.documents('api::brainstorm-session.brainstorm-session').update({
              documentId: session.documentId,
              data: { status: 'failed' }
            });
            ctx.status = 502; ctx.body = { error: 'LLM failed', detail: String(err?.message || err) };
            return;
          }
        }

        // Only mark the idea as brainstorming after architecture generation succeeds.
        await strapi.documents('api::idea.idea').update({ documentId: ideaId, data: { status: 'brainstorming' } });
        try { await strapi.documents('api::idea.idea').publish({ documentId: ideaId }); } catch {}

        // Update session with proposal
        await strapi.documents('api::brainstorm-session.brainstorm-session').update({
          documentId: session.documentId,
          data: {
            architecture_proposal: architectureProposal,
            status: 'awaiting_architecture_approval'
          }
        });

        ctx.body = {
          data: {
            message: `Brainstorm started for "${idea.title}"`,
            session_id: session.documentId,
            architecture_proposal: architectureProposal
          }
        };
        return;
      }

      // GET /api/brainstorm/idea/:ideaId/active — Find active session without frontend GraphQL relation permissions
      if (method === 'GET' && /^\/api\/brainstorm\/idea\/([^/]+)\/active$/.test(path)) {
        const ideaId = path.match(/^\/api\/brainstorm\/idea\/([^/]+)\/active$/)[1];
        const sessions = await strapi.documents('api::brainstorm-session.brainstorm-session').findMany({
          filters: { idea: { documentId: ideaId } },
          sort: { createdAt: 'desc' },
          limit: 10,
          populate: ['idea']
        });
        const activeSession = (sessions || []).find(s => s.status !== 'completed' && s.status !== 'failed') || null;
        ctx.body = { data: activeSession };
        return;
      }

      // GET /api/brainstorm/:sessionId — Get session details
      if (method === 'GET' && /^\/api\/brainstorm\/([^/]+)$/.test(path) && !path.includes('/questions')) {
        const sessionId = path.match(/^\/api\/brainstorm\/([^/]+)$/)[1];

        const session = await strapi.documents('api::brainstorm-session.brainstorm-session').findOne({
          documentId: sessionId,
          populate: ['idea', 'questions', 'build_steps', 'refinements']
        });

        if (!session) { ctx.status = 404; ctx.body = { error: 'Session not found' }; return; }

        ctx.body = { data: session };
        return;
      }

      // PUT /api/brainstorm/:sessionId/choose — Select architecture option
      if (method === 'PUT' && /^\/api\/brainstorm\/([^/]+)\/choose$/.test(path)) {
        const sessionId = path.match(/^\/api\/brainstorm\/([^/]+)\/choose$/)[1];
        const body = await parseBody(ctx);
        const { option_id } = body;

        if (!option_id) { ctx.status = 400; ctx.body = { error: 'option_id required' }; return; }

        const session = await strapi.documents('api::brainstorm-session.brainstorm-session').findOne({
          documentId: sessionId, populate: ['idea']
        });
        if (!session) { ctx.status = 404; ctx.body = { error: 'Session not found' }; return; }

        const proposal = session.architecture_proposal;
        // option_id may be a string id ('opt-1') or a 1-based index number from the bot — resolve both.
        const _opts = proposal?.options || [];
        const chosenOption = _opts.find(o => String(o.id) === String(option_id)) || _opts[Number(option_id) - 1];
        if (!chosenOption) { ctx.status = 400; ctx.body = { error: 'Invalid option_id' }; return; }

        await strapi.documents('api::brainstorm-session.brainstorm-session').update({
          documentId: sessionId,
          data: { chosen_architecture: chosenOption }
        });

        ctx.body = { data: { message: `Architecture "${chosenOption.name}" selected`, chosen: chosenOption } };
        return;
      }

      // POST /api/brainstorm/:sessionId/approve — Approve current stage
      if (method === 'POST' && /^\/api\/brainstorm\/([^/]+)\/approve$/.test(path)) {
        const sessionId = path.match(/^\/api\/brainstorm\/([^/]+)\/approve$/)[1];
        const body = await parseBody(ctx);
        const { stage, feedback } = body; // stage: 'architecture' | 'plan' | 'build'

        const session = await strapi.documents('api::brainstorm-session.brainstorm-session').findOne({
          documentId: sessionId, populate: ['idea', 'questions']
        });
        if (!session) { ctx.status = 404; ctx.body = { error: 'Session not found' }; return; }

        if (stage === 'architecture') {
          if (!session.chosen_architecture) {
            ctx.status = 400; ctx.body = { error: 'Choose an architecture first' }; return;
          }
          await strapi.documents('api::brainstorm-session.brainstorm-session').update({
            documentId: sessionId,
            data: {
              human_approval_stage: 'architecture_approved',
              status: 'qa_in_progress'
            }
          });
          ctx.body = { data: { message: 'Architecture approved. Q&A phase begins.', next: 'qa' } };
        } else if (stage === 'plan') {
          // Generate QA summary from answered questions
          const questions = session.questions || [];
          const answered = questions.filter(q => q.status === 'answered');
          const summary = {};
          answered.forEach(q => { summary[q.question_text] = q.answer; });

          await strapi.documents('api::brainstorm-session.brainstorm-session').update({
            documentId: sessionId,
            data: {
              human_approval_stage: 'qa_approved',
              qa_summary: summary,
              status: 'ready_to_build'
            }
          });
          ctx.body = { data: { message: 'Plan approved. Ready to build.', next: 'build' } };
        } else if (stage === 'build') {
          await strapi.documents('api::brainstorm-session.brainstorm-session').update({
            documentId: sessionId,
            data: {
              human_approval_stage: 'build_approved',
              status: 'completed'
            }
          });
          // Update idea status
          await strapi.documents('api::idea.idea').update({
            documentId: session.idea.documentId,
            data: { status: 'launched' }
          });
          try { await strapi.documents('api::idea.idea').publish({ documentId: session.idea.documentId }); } catch {}
          ctx.body = { data: { message: 'Build approved. Project completed!', next: 'done' } };
        } else {
          ctx.status = 400; ctx.body = { error: 'Invalid stage. Use: architecture, plan, build' }; return;
        }
        return;
      }

      // POST /api/brainstorm/:sessionId/layers — Set build layer order
      if (method === 'POST' && /^\/api\/brainstorm\/([^/]+)\/layers$/.test(path)) {
        const sessionId = path.match(/^\/api\/brainstorm\/([^/]+)\/layers$/)[1];
        const body = await parseBody(ctx);
        const { layers } = body; // array of layer names

        if (!layers || !Array.isArray(layers)) {
          ctx.status = 400; ctx.body = { error: 'layers array required' }; return;
        }

        const validLayers = ['database_schema', 'api_backend', 'frontend', 'auth', 'docker', 'tests', 'docs'];
        const invalid = layers.filter(l => !validLayers.includes(l));
        if (invalid.length > 0) {
          ctx.status = 400; ctx.body = { error: `Invalid layers: ${invalid.join(', ')}. Valid: ${validLayers.join(', ')}` }; return;
        }

        await strapi.documents('api::brainstorm-session.brainstorm-session').update({
          documentId: sessionId,
          data: { build_layers: layers }
        });

        ctx.body = { data: { message: 'Build layers set', layers } };
        return;
      }

      // =====================================================================
      // Q&A ROUTES
      // =====================================================================

      // GET /api/brainstorm/:sessionId/questions — Get all questions
      if (method === 'GET' && /^\/api\/brainstorm\/([^/]+)\/questions$/.test(path)) {
        const sessionId = path.match(/^\/api\/brainstorm\/([^/]+)\/questions$/)[1];

        const questions = await strapi.documents('api::clarifying-question.clarifying-question').findMany({
          filters: { session: { documentId: sessionId } },
          sort: { order: 'asc' }
        });

        ctx.body = { data: questions };
        return;
      }

      // POST /api/brainstorm/:sessionId/questions/generate — Generate questions
      if (method === 'POST' && /^\/api\/brainstorm\/([^/]+)\/questions\/generate$/.test(path)) {
        const sessionId = path.match(/^\/api\/brainstorm\/([^/]+)\/questions\/generate$/)[1];

        const session = await strapi.documents('api::brainstorm-session.brainstorm-session').findOne({
          documentId: sessionId, populate: ['idea', 'idea.analysis', 'questions']
        });
        if (!session) { ctx.status = 404; ctx.body = { error: 'Session not found' }; return; }

        const idea = session.idea;
        const analysis = idea?.analysis;
        const arch = session.chosen_architecture;

        const prompt = `Generate 8-12 clarifying questions to finalize this project specification.

Title: ${idea.title}
Description: ${idea.description}
${analysis ? `Problem: ${analysis.problem_statement}\nTarget: ${analysis.target_audience}` : ''}
Architecture: ${arch?.name || 'Not chosen'}
Stack: ${arch?.stack?.join(', ') || 'TBD'}

Cover: UX/layout, auth, data model, integrations, scale, design, content types, notifications, admin, MVP scope.

Each question: question_text, question_type (single_choice|multiple_choice|text|boolean), options (array for choice types), context (why it matters).

Return JSON: { "questions": [...] }`;

        let generated;
        try {
          generated = await analyzeWithLLM(prompt, 'analysis');
          if (!generated || !Array.isArray(generated.questions) || generated.questions.length === 0) {
            throw new Error('LLM questions returned invalid shape (missing questions[])');
          }
        } catch (err) {
          if (process.env.MOCK_MODE === '1') {
            generated = generateMockQuestions(idea, arch);
          } else {
            ctx.status = 502; ctx.body = { error: 'LLM failed', detail: String(err?.message || err) };
            return;
          }
        }

        // Save questions to DB
        const existingCount = session.questions?.length || 0;
        const savedQuestions = [];
        for (let i = 0; i < generated.questions.length; i++) {
          const q = generated.questions[i];
          const saved = await strapi.documents('api::clarifying-question.clarifying-question').create({
            data: {
              session: sessionId,
              question_text: q.question_text,
              question_type: q.question_type || 'text',
              options: q.options || [],
              context: q.context || '',
              status: 'pending',
              asked_via: 'both',
              order: existingCount + i + 1
            }
          });
          savedQuestions.push(saved);
        }

        ctx.body = { data: { message: `Generated ${savedQuestions.length} questions`, questions: savedQuestions } };
        return;
      }

      // POST /api/brainstorm/:sessionId/questions/:questionId/answer — Submit answer
      if (method === 'POST' && /^\/api\/brainstorm\/([^/]+)\/questions\/([^/]+)\/answer$/.test(path)) {
        const match = path.match(/^\/api\/brainstorm\/([^/]+)\/questions\/([^/]+)\/answer$/);
        const sessionId = match[1];
        const questionId = match[2];
        const body = await parseBody(ctx);
        const { answer, answered_via } = body;

        if (answer === undefined) { ctx.status = 400; ctx.body = { error: 'answer required' }; return; }

        const question = await strapi.documents('api::clarifying-question.clarifying-question').findOne({
          documentId: questionId
        });
        if (!question) { ctx.status = 404; ctx.body = { error: 'Question not found' }; return; }

        const updated = await strapi.documents('api::clarifying-question.clarifying-question').update({
          documentId: questionId,
          data: {
            answer: String(answer),
            status: 'answered',
            answered_via: answered_via || 'web'
          }
        });

        // Check if all questions answered
        const allQuestions = await strapi.documents('api::clarifying-question.clarifying-question').findMany({
          filters: { session: { documentId: sessionId } }
        });
        const allAnswered = allQuestions.every(q => q.status === 'answered' || q.status === 'skipped');

        if (allAnswered) {
          await strapi.documents('api::brainstorm-session.brainstorm-session').update({
            documentId: sessionId,
            data: { status: 'qa_completed' }
          });
        }

        ctx.body = { data: { message: 'Answer saved', question: updated, all_answered: allAnswered } };
        return;
      }

      // =====================================================================
      // BUILD ROUTES
      // =====================================================================

      // POST /api/build/:sessionId/start — Start code generation
      if (method === 'POST' && /^\/api\/build\/([^/]+)\/start$/.test(path)) {
        const sessionId = path.match(/^\/api\/build\/([^/]+)\/start$/)[1];

        const session = await strapi.documents('api::brainstorm-session.brainstorm-session').findOne({
          documentId: sessionId, populate: ['idea', 'idea.analysis', 'questions', 'build_steps']
        });
        if (!session) { ctx.status = 404; ctx.body = { error: 'Session not found' }; return; }

        if (!session.build_layers || session.build_layers.length === 0) {
          ctx.status = 400; ctx.body = { error: 'Set build layers first' }; return;
        }

        // Update session status
        await strapi.documents('api::brainstorm-session.brainstorm-session').update({
          documentId: sessionId,
          data: { status: 'building', build_progress: 0 }
        });

        // Create build step records for each layer
        const layers = session.build_layers;
        for (let i = 0; i < layers.length; i++) {
          await strapi.documents('api::build-step.build-step').create({
            data: {
              session: sessionId,
              layer: layers[i],
              status: 'pending',
              order: i + 1
            }
          });
        }

        // Start building first layer (async - don't block response)
        const idea = session.idea;
        const analysis = idea.analysis;
        const arch = session.chosen_architecture;
        const qaSummary = session.qa_summary || {};

        // Build first layer immediately
        buildLayer(strapi, sessionId, layers[0], idea, analysis, arch, qaSummary, {}).catch(err => {
          console.error(`Build layer ${layers[0]} failed:`, err);
        });

        ctx.body = { data: { message: 'Build started', layers, first_layer: layers[0] } };
        return;
      }

      // GET /api/build/:sessionId/status — Poll build progress
      if (method === 'GET' && /^\/api\/build\/([^/]+)\/status$/.test(path)) {
        const sessionId = path.match(/^\/api\/build\/([^/]+)\/status$/)[1];

        const session = await strapi.documents('api::brainstorm-session.brainstorm-session').findOne({
          documentId: sessionId, populate: ['build_steps']
        });
        if (!session) { ctx.status = 404; ctx.body = { error: 'Session not found' }; return; }

        const steps = (session.build_steps || []).sort((a, b) => a.order - b.order);
        const completedSteps = steps.filter(s => s.status === 'completed' || s.status === 'approved').length;
        const totalSteps = steps.length;
        const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

        // Auto-advance to next layer if current is completed
        const currentPending = steps.find(s => s.status === 'pending' || s.status === 'generating');
        const lastCompleted = steps.filter(s => s.status === 'completed').pop();

        ctx.body = {
          data: {
            status: session.status,
            progress,
            current_layer: currentPending?.layer || null,
            current_layer_status: currentPending?.status || null,
            layers: steps.map(s => ({
              layer: s.layer,
              status: s.status,
              files_count: s.files_generated ? (Array.isArray(s.files_generated) ? s.files_generated.length : 0) : 0,
              output_summary: s.output_summary,
              error: s.error_message,
              started_at: s.started_at,
              completed_at: s.completed_at
            })),
            completed_count: completedSteps,
            total_count: totalSteps
          }
        };
        return;
      }

      // POST /api/build/:sessionId/layer/:layer/approve — Approve single layer
      if (method === 'POST' && /^\/api\/build\/([^/]+)\/layer\/([^/]+)\/approve$/.test(path)) {
        const match = path.match(/^\/api\/build\/([^/]+)\/layer\/([^/]+)\/approve$/);
        const sessionId = match[1];
        const layer = match[2];

        const buildStep = await strapi.documents('api::build-step.build-step').findMany({
          filters: { session: { documentId: sessionId }, layer }
        });

        if (!buildStep || buildStep.length === 0) {
          ctx.status = 404; ctx.body = { error: 'Build step not found' }; return;
        }

        await strapi.documents('api::build-step.build-step').update({
          documentId: buildStep[0].documentId,
          data: { status: 'approved' }
        });

        // Check if all layers approved
        const allSteps = await strapi.documents('api::build-step.build-step').findMany({
          filters: { session: { documentId: sessionId } }
        });
        const allApproved = allSteps.every(s => s.status === 'approved');

        if (allApproved) {
          await strapi.documents('api::brainstorm-session.brainstorm-session').update({
            documentId: sessionId,
            data: { status: 'build_completed', build_progress: 100 }
          });
        }

        // Auto-start next layer
        const session = await strapi.documents('api::brainstorm-session.brainstorm-session').findOne({
          documentId: sessionId, populate: ['idea', 'idea.analysis']
        });
        const nextPending = allSteps.find(s => s.status === 'pending');
        if (nextPending && session) {
          const idea = session.idea;
          const analysis = idea.analysis;
          const arch = session.chosen_architecture;
          const qaSummary = session.qa_summary || {};
          const prevLayers = {};
          allSteps.filter(s => s.status === 'approved' || s.status === 'completed').forEach(s => {
            prevLayers[s.layer] = s.output_summary || '';
          });
          buildLayer(strapi, sessionId, nextPending.layer, idea, analysis, arch, qaSummary, prevLayers).catch(err => {
            console.error(`Build layer ${nextPending.layer} failed:`, err);
          });
        }

        ctx.body = { data: { message: `Layer "${layer}" approved`, all_approved: allApproved } };
        return;
      }

      // POST /api/build/:sessionId/layer/:layer/regenerate — Regenerate single layer
      if (method === 'POST' && /^\/api\/build\/([^/]+)\/layer\/([^/]+)\/regenerate$/.test(path)) {
        const match = path.match(/^\/api\/build\/([^/]+)\/layer\/([^/]+)\/regenerate$/);
        const sessionId = match[1];
        const layer = match[2];
        const body = await parseBody(ctx);
        const { reason } = body;

        const buildStep = await strapi.documents('api::build-step.build-step').findMany({
          filters: { session: { documentId: sessionId }, layer }
        });

        if (!buildStep || buildStep.length === 0) {
          ctx.status = 404; ctx.body = { error: 'Build step not found' }; return;
        }

        await strapi.documents('api::build-step.build-step').update({
          documentId: buildStep[0].documentId,
          data: { status: 'regenerating', error_message: reason || null }
        });

        // Re-run the layer
        const session = await strapi.documents('api::brainstorm-session.brainstorm-session').findOne({
          documentId: sessionId, populate: ['idea', 'idea.analysis']
        });

        if (session) {
          const idea = session.idea;
          const analysis = idea.analysis;
          const arch = session.chosen_architecture;
          const qaSummary = session.qa_summary || {};
          const prevLayers = {};
          const allSteps = await strapi.documents('api::build-step.build-step').findMany({
            filters: { session: { documentId: sessionId } }
          });
          allSteps.filter(s => (s.status === 'approved' || s.status === 'completed') && s.layer !== layer).forEach(s => {
            prevLayers[s.layer] = s.output_summary || '';
          });

          buildLayer(strapi, sessionId, layer, idea, analysis, arch, qaSummary, prevLayers, reason).catch(err => {
            console.error(`Regenerate layer ${layer} failed:`, err);
          });
        }

        ctx.body = { data: { message: `Layer "${layer}" regeneration started` } };
        return;
      }

      // POST /api/build/:sessionId/push — Push to GitHub
      if (method === 'POST' && /^\/api\/build\/([^/]+)\/push$/.test(path)) {
        const sessionId = path.match(/^\/api\/build\/([^/]+)\/push$/)[1];

        const session = await strapi.documents('api::brainstorm-session.brainstorm-session').findOne({
          documentId: sessionId, populate: ['idea', 'build_steps']
        });
        if (!session) { ctx.status = 404; ctx.body = { error: 'Session not found' }; return; }

        const buildDir = workspaceFor(sessionId);
        if (!fs.existsSync(buildDir)) {
          ctx.status = 400; ctx.body = { error: 'No build output found' }; return;
        }

        const idea = session.idea;
        const repoName = sanitizeRepoName(idea.title);

        // Create GitHub repo and push all generated files via the REST Git Data API.
        let repoUrl = '';
        let pushed = false;
        if (!githubConfigured()) {
          ctx.status = 503;
          ctx.body = { error: 'GitHub push not configured', detail: githubConfigStatus().reason };
          return;
        }
        try {
          const files = readAllFiles(buildDir);
          const result = await createRepoAndPush({ name: sanitizeRepoName(idea.title), description: idea.description, private: true, files });
          repoUrl = result.html_url;
          pushed = true;
        } catch (err) {
          ctx.status = 502; ctx.body = { error: 'GitHub push failed', detail: String(err?.message || err) };
          return;
        }

        // Update session
        await strapi.documents('api::brainstorm-session.brainstorm-session').update({
          documentId: sessionId,
          data: {
            generated_repo_url: repoUrl,
            status: pushed ? 'awaiting_review' : 'build_completed'
          }
        });

        // Create/update repo record
        const http = require('http');
        const repoPayload = JSON.stringify({ data: { repo_name: repoName, repo_url: repoUrl, visibility: 'private', github_created: pushed } });
        try {
          await new Promise((resolve, reject) => {
            const req = http.request({ hostname: '127.0.0.1', port: 1337, path: '/api/repos', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(repoPayload) } }, (res) => {
              let body = '';
              res.on('data', chunk => body += chunk);
              res.on('end', () => resolve());
            });
            req.on('error', reject);
            req.write(repoPayload);
            req.end();
          });
        } catch {}

        ctx.body = { data: { message: pushed ? 'Pushed to GitHub' : 'Build saved locally', repo_url: repoUrl, pushed } };
        return;
      }

      // =====================================================================
      // REFINEMENT ROUTES
      // =====================================================================

      // POST /api/refine/:sessionId — Submit refinement request
      if (method === 'POST' && /^\/api\/refine\/([^/]+)$/.test(path)) {
        const sessionId = path.match(/^\/api\/refine\/([^/]+)$/)[1];
        const body = await parseBody(ctx);
        const { request_text, target_layers } = body;

        if (!request_text) { ctx.status = 400; ctx.body = { error: 'request_text required' }; return; }

        const session = await strapi.documents('api::brainstorm-session.brainstorm-session').findOne({
          documentId: sessionId, populate: ['idea', 'idea.analysis', 'refinements']
        });
        if (!session) { ctx.status = 404; ctx.body = { error: 'Session not found' }; return; }

        const iterationNumber = (session.refinements?.length || 0) + 1;

        // If no target layers specified, analyze impact
        let affectedLayers = target_layers;
        let impactAnalysis = '';

        if (!affectedLayers || affectedLayers.length === 0) {
          const idea = session.idea;
          const prompt = `Given this project and a refinement request, determine which layers need regeneration.

Project: ${idea.title}
Description: ${idea.description}
Architecture: ${session.chosen_architecture?.name || 'N/A'}
Stack: ${session.chosen_architecture?.stack?.join(', ') || 'N/A'}

Refinement Request: ${request_text}

Available layers: database_schema, api_backend, frontend, auth, docker, tests, docs

Return JSON: { "affected_layers": ["layer1", "layer2"], "impact_analysis": "Brief explanation" }`;

          // Non-critical: a failure here falls back to a target_layers heuristic, not a 502.
          let analysis = null;
          try {
            analysis = await analyzeWithLLM(prompt, 'analysis');
          } catch (err) {
            analysis = null;
          }
          affectedLayers = (Array.isArray(analysis?.affected_layers) && analysis.affected_layers.length > 0)
            ? analysis.affected_layers
            : ['api_backend', 'frontend'];
          impactAnalysis = analysis?.impact_analysis || `Will regenerate: ${affectedLayers.join(', ')}`;
        }

        // Create refinement request
        const refinement = await strapi.documents('api::refinement-request.refinement-request').create({
          data: {
            session: sessionId,
            request_text,
            target_layers: affectedLayers,
            impact_analysis: impactAnalysis,
            status: 'pending',
            iteration_number: iterationNumber
          }
        });

        // Update session
        await strapi.documents('api::brainstorm-session.brainstorm-session').update({
          documentId: sessionId,
          data: {
            status: 'refining',
            iteration_count: iterationNumber
          }
        });

        // Mark affected build steps for regeneration
        for (const layer of affectedLayers) {
          const steps = await strapi.documents('api::build-step.build-step').findMany({
            filters: { session: { documentId: sessionId }, layer }
          });
          if (steps.length > 0) {
            await strapi.documents('api::build-step.build-step').update({
              documentId: steps[0].documentId,
              data: { status: 'regenerating' }
            });
          }
        }

        ctx.body = { data: { message: 'Refinement queued', refinement, affected_layers: affectedLayers, impact: impactAnalysis } };
        return;
      }

      // GET /api/refine/:sessionId/history — Get all iterations
      if (method === 'GET' && /^\/api\/refine\/([^/]+)\/history$/.test(path)) {
        const sessionId = path.match(/^\/api\/refine\/([^/]+)\/history$/)[1];

        const refinements = await strapi.documents('api::refinement-request.refinement-request').findMany({
          filters: { session: { documentId: sessionId } },
          sort: { iteration_number: 'asc' }
        });

        ctx.body = { data: refinements };
        return;
      }

      // =====================================================================
      // FORGE ONE-COMMAND PIPELINE
      // =====================================================================

      // GET /api/forge/health — provider/config status
      if (method === 'GET' && /^\/api\/forge\/health$/.test(path)) {
        const analysis = llmInfo('analysis');
        const codegen = llmInfo('codegen');
        const github = githubConfigStatus();
        ctx.body = {
          ok: analysis.configured && codegen.configured,
          analysis,
          codegen,
          github,
          deploy_enabled: DEPLOY_ENABLED,
          mock_mode: process.env.MOCK_MODE === '1',
          message: [
            analysis.configured ? `Analysis ${analysis.provider}/${analysis.model} configured` : `Analysis ${analysis.provider}/${analysis.model} missing config`,
            codegen.configured ? `Codegen ${codegen.provider}/${codegen.model} configured` : `Codegen ${codegen.provider}/${codegen.model} missing config`,
            github.configured ? 'GitHub configured' : 'GitHub not configured'
          ].join('; ')
        };
        return;
      }

      // POST /api/forge/:ideaId/run — analyze -> architecture (auto-pick) -> questions -> await approval
      if (method === 'POST' && /^\/api\/forge\/([^/]+)\/run$/.test(path)) {
        const ideaId = path.match(/^\/api\/forge\/([^/]+)\/run$/)[1];
        const body = await parseBody(ctx);

        const idea = await strapi.documents('api::idea.idea').findOne({ documentId: ideaId, populate: ['analysis', 'brainstorm_sessions'] });
        if (!idea) { ctx.status = 404; ctx.body = { error: 'Idea not found' }; return; }

        // 1) Ensure analysis exists (run the same logic as /analyze inline).
        let analysisData = idea.analysis || null;
        if (!analysisData) {
          const aPrompt = `Analyze this startup idea. Return JSON: problem_statement, target_audience, business_model, revenue_potential(low/medium/high), technical_complexity(low/medium/high), dev_effort_hours(int), risk_assessment, market_opportunity, viability_score(0-100).\n\nTitle: ${idea.title}\nDesc: ${idea.description}\nCategory: ${idea.category || 'other'}`;
          let aData;
          try {
            aData = await analyzeWithLLM(aPrompt, 'analysis');
            if (!aData || typeof aData !== 'object' || !aData.problem_statement) {
              throw new Error('LLM analysis returned invalid shape (missing problem_statement)');
            }
          } catch (err) {
            if (process.env.MOCK_MODE === '1') {
              aData = generateMockAnalysis(idea);
            } else {
              ctx.status = 502; ctx.body = { error: 'LLM failed', detail: String(err?.message || err) };
              return;
            }
          }
          const validLevels = ['low', 'medium', 'high'];
          if (!validLevels.includes(aData.revenue_potential)) aData.revenue_potential = 'medium';
          if (!validLevels.includes(aData.technical_complexity)) aData.technical_complexity = 'medium';
          aData.viability_score = Math.max(0, Math.min(100, parseInt(aData.viability_score) || 50));
          aData.dev_effort_hours = parseInt(aData.dev_effort_hours) || 400;
          aData.raw_ai_output = aData.raw_ai_output || JSON.stringify(aData);

          analysisData = await strapi.documents('api::analysis.analysis').create({ data: { ...aData, idea: ideaId } });
          await strapi.documents('api::idea.idea').update({ documentId: ideaId, data: { status: 'analyzed', analysis: analysisData.documentId } });
          try { await strapi.documents('api::idea.idea').publish({ documentId: ideaId }); } catch {}
        }

        // 2) Create brainstorm session.
        const session = await strapi.documents('api::brainstorm-session.brainstorm-session').create({
          data: {
            idea: ideaId,
            status: 'brainstorming',
            build_progress: 0,
            iteration_count: 0,
            human_approval_stage: 'none'
          }
        });
        // 3) Generate architecture via real LLM.
        const archPrompt = `Analyze this startup idea and propose 2-3 architecture options with clear trade-offs.

Title: ${idea.title}
Description: ${idea.description}
Category: ${idea.category || 'other'}
${analysisData ? `Problem: ${analysisData.problem_statement}\nTarget Audience: ${analysisData.target_audience}\nComplexity: ${analysisData.technical_complexity}` : ''}

For each option provide: id, name, description, stack (array), pros (array), cons (array), estimated_hours (int), best_for (string).

Return JSON: { "options": [...] }`;

        let architectureProposal;
        try {
          architectureProposal = await analyzeWithLLM(archPrompt, 'analysis');
          if (!architectureProposal || !Array.isArray(architectureProposal.options) || architectureProposal.options.length === 0) {
            throw new Error('LLM architecture returned invalid shape (missing options[])');
          }
        } catch (err) {
          if (process.env.MOCK_MODE === '1') {
            architectureProposal = generateMockArchitecture(idea, analysisData);
          } else {
            await strapi.documents('api::brainstorm-session.brainstorm-session').update({
              documentId: session.documentId, data: { status: 'failed' }
            });
            ctx.status = 502; ctx.body = { error: 'LLM failed', detail: String(err?.message || err) };
            return;
          }
        }

        await strapi.documents('api::idea.idea').update({ documentId: ideaId, data: { status: 'brainstorming' } });
        try { await strapi.documents('api::idea.idea').publish({ documentId: ideaId }); } catch {}

        // Auto-select highest-viability option (fall back to the first).
        const options = architectureProposal.options;
        const score = (o) => {
          const v = parseInt(o?.estimated_viability ?? o?.viability ?? o?.viability_score);
          return isNaN(v) ? -1 : v;
        };
        let chosen = options[0];
        for (const o of options) { if (score(o) > score(chosen)) chosen = o; }

        await strapi.documents('api::brainstorm-session.brainstorm-session').update({
          documentId: session.documentId,
          data: {
            architecture_proposal: architectureProposal,
            chosen_architecture: chosen,
            human_approval_stage: 'architecture_approved',
            status: 'awaiting_architecture_approval'
          }
        });

        // 4) Generate clarifying questions (best-effort — never fail the request).
        const qPrompt = `Generate 8-12 clarifying questions to finalize this project specification.

Title: ${idea.title}
Description: ${idea.description}
${analysisData ? `Problem: ${analysisData.problem_statement}\nTarget: ${analysisData.target_audience}` : ''}
Architecture: ${chosen?.name || 'Not chosen'}
Stack: ${chosen?.stack?.join(', ') || 'TBD'}

Cover: UX/layout, auth, data model, integrations, scale, design, content types, notifications, admin, MVP scope.

Each question: question_text, question_type (single_choice|multiple_choice|text|boolean), options (array for choice types), context (why it matters).

Return JSON: { "questions": [...] }`;
        try {
          let generated = await analyzeWithLLM(qPrompt, 'analysis');
          if (!generated || !Array.isArray(generated.questions)) {
            if (process.env.MOCK_MODE === '1') generated = generateMockQuestions(idea, chosen);
            else generated = { questions: [] };
          }
          for (let i = 0; i < generated.questions.length; i++) {
            const q = generated.questions[i];
            await strapi.documents('api::clarifying-question.clarifying-question').create({
              data: {
                session: session.documentId,
                question_text: q.question_text,
                question_type: q.question_type || 'text',
                options: q.options || [],
                context: q.context || '',
                status: 'pending',
                asked_via: 'both',
                order: i + 1
              }
            });
          }
        } catch (err) { /* best-effort: questions are non-blocking */ }

        // 5) Manual-approval gate.
        await strapi.documents('api::brainstorm-session.brainstorm-session').update({
          documentId: session.documentId,
          data: { status: 'awaiting_plan_approval' }
        });

        if (body && body.auto === true) {
          await runForgeContinue(strapi, ctx, session.documentId);
          return;
        }

        ctx.body = {
          status: 'awaiting_approval',
          session_id: session.documentId,
          architecture: chosen,
          approve_url: 'POST /api/forge/' + session.documentId + '/continue'
        };
        return;
      }

      // POST /api/forge/:sessionId/continue — human-approved: build all layers, push, deploy
      if (method === 'POST' && /^\/api\/forge\/([^/]+)\/continue$/.test(path)) {
        const sessionId = path.match(/^\/api\/forge\/([^/]+)\/continue$/)[1];
        await runForgeContinue(strapi, ctx, sessionId);
        return;
      }

      await next();
    });
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // Seed REST permissions so every pipeline content-type is reachable.
    // Without this, core routes like GET /api/brainstorm-sessions return 403.
    const contentTypes = [
      'idea', 'analysis', 'priority', 'repo', 'note',
      'brainstorm-session', 'build-step', 'clarifying-question', 'refinement-request',
    ];
    const verbs = ['find', 'findOne', 'create', 'update', 'delete'];

    for (const roleType of ['public', 'authenticated']) {
      const role = await strapi
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: roleType } });
      if (!role) continue;

      for (const ct of contentTypes) {
        for (const verb of verbs) {
          const action = `api::${ct}.${ct}.${verb}`;
          const existing = await strapi
            .query('plugin::users-permissions.permission')
            .findOne({ where: { action, role: role.id } });
          if (!existing) {
            await strapi
              .query('plugin::users-permissions.permission')
              .create({ data: { action, role: role.id } });
          }
        }
      }
    }
  },
};

// =====================================================================
// BUILD LAYER EXECUTOR (runs async)
// =====================================================================

async function buildLayer(strapi, sessionId, layer, idea, analysis, arch, qaSummary, prevLayers, regenerateReason = null) {
  const workspace = workspaceFor(sessionId);

  // Ensure build directory exists
  if (!fs.existsSync(workspace)) {
    fs.mkdirSync(workspace, { recursive: true });
  }

  // Update build step status
  const steps = await strapi.documents('api::build-step.build-step').findMany({
    filters: { session: { documentId: sessionId }, layer }
  });

  if (steps.length === 0) return;

  const stepDocId = steps[0].documentId;
  await strapi.documents('api::build-step.build-step').update({
    documentId: stepDocId,
    data: { status: 'generating', started_at: new Date().toISOString() }
  });

  // Update session progress
  const allSteps = await strapi.documents('api::build-step.build-step').findMany({
    filters: { session: { documentId: sessionId } }
  });
  const completedCount = allSteps.filter(s => s.status === 'completed' || s.status === 'approved').length;
  const progress = Math.round((completedCount / allSteps.length) * 100);

  await strapi.documents('api::brainstorm-session.brainstorm-session').update({
    documentId: sessionId,
    data: { current_build_layer: layer, build_progress: progress }
  });

  // Build the prompt
  const promptFn = LAYER_PROMPTS[layer];
  if (!promptFn) {
    await strapi.documents('api::build-step.build-step').update({
      documentId: stepDocId,
      data: { status: 'failed', error_message: `Unknown layer: ${layer}`, completed_at: new Date().toISOString() }
    });
    return;
  }

  let prompt = promptFn(idea, analysis, arch, qaSummary, prevLayers);
  if (regenerateReason) {
    prompt += `\n\nIMPORTANT: Previous generation was rejected. Reason: ${regenerateReason}\nPlease address this feedback and improve the output.`;
  }

  // Verify/repair loop: generate -> write -> verify; on failure, re-prompt with the errors (max 3 attempts).
  let attempts = 0;
  let v = null;
  let res = null;
  while (attempts < 3) {
    try {
      res = await callLLMJson(prompt, { task: 'codegen', timeoutMs: 300000 });
    } catch (err) {
      res = null;
    }

    if (!res || !Array.isArray(res.files) || res.files.length === 0) {
      // Could not even get a files[] payload this attempt.
      attempts++;
      await strapi.documents('api::build-step.build-step').update({
        documentId: stepDocId,
        data: { retry_count: attempts }
      });
      if (attempts >= 3) {
        v = { ok: false, step: 'install', log: 'LLM did not return a valid files[] payload after 3 attempts.' };
        break;
      }
      continue;
    }

    writeWorkspaceFiles(workspace, res.files);
    v = await verifyTypeScript(workspace);

    if (v.ok) break;

    attempts++;
    await strapi.documents('api::build-step.build-step').update({
      documentId: stepDocId,
      data: { retry_count: attempts }
    });
    if (attempts >= 3) break;

    prompt += `\n\nThe previous attempt FAILED verification (${v.step}):\n${v.log}\nReturn ALL files again as JSON {files:[{path,content}]}, fixing the errors.`;
  }

  if (v && v.ok) {
    await saveBuildOutput(
      strapi, stepDocId, sessionId, layer, res.files,
      `${res.description || `Generated ${layer}`} (verified: ${v.step})`,
      allSteps
    );
    return;
  }

  // Exhausted: keep the pipeline usable with deterministic templates. The
  // build-step summary records that the fallback was used, so the UI doesn't
  // falsely imply the LLM-generated payload passed verification.
  const fallbackFiles = generateFallbackFiles(layer, idea, arch);
  await saveBuildOutput(
    strapi,
    stepDocId,
    sessionId,
    layer,
    fallbackFiles,
    `Generated with fallback templates after codegen failed: ${v?.log || 'invalid files[] payload'}`,
    allSteps
  );
  return;
}

async function saveBuildOutput(strapi, stepDocId, sessionId, layer, files, description, allSteps) {
  const workspace = workspaceFor(sessionId);

  // Write files to the persistent workspace volume.
  writeWorkspaceFiles(workspace, files);

  // Update build step
  await strapi.documents('api::build-step.build-step').update({
    documentId: stepDocId,
    data: {
      status: 'completed',
      files_generated: files.map(f => ({ path: f.path, lines: (f.content || '').split('\n').length })),
      output_summary: description,
      completed_at: new Date().toISOString()
    }
  });

  // Update progress
  const updatedSteps = await strapi.documents('api::build-step.build-step').findMany({
    filters: { session: { documentId: sessionId } }
  });
  const completedCount = updatedSteps.filter(s => s.status === 'completed' || s.status === 'approved').length;
  const progress = Math.round((completedCount / updatedSteps.length) * 100);

  await strapi.documents('api::brainstorm-session.brainstorm-session').update({
    documentId: sessionId,
    data: { build_progress: progress }
  });

  // Check if all layers done
  const allDone = updatedSteps.every(s => s.status === 'completed' || s.status === 'approved');
  if (allDone) {
    await strapi.documents('api::brainstorm-session.brainstorm-session').update({
      documentId: sessionId,
      data: { status: 'build_completed', build_progress: 100 }
    });
  }
}

// =====================================================================
// FORGE CONTINUE — post-approval build/push/deploy pipeline
// =====================================================================

async function runForgeContinue(strapi, ctx, sessionId) {
  const session = await strapi.documents('api::brainstorm-session.brainstorm-session').findOne({
    documentId: sessionId, populate: ['idea', 'idea.analysis', 'build_steps']
  });
  if (!session) { ctx.status = 404; ctx.body = { error: 'Session not found' }; return; }

  const idea = session.idea;
  const analysis = idea?.analysis || null;
  const arch = session.chosen_architecture;
  const qaSummary = session.qa_summary || {};

  try {
    // 1) Default build layers + build-step rows.
    let layers = session.build_layers;
    if (!layers || layers.length === 0) {
      layers = ['database_schema', 'api_backend', 'frontend', 'docker', 'docs'];
      await strapi.documents('api::brainstorm-session.brainstorm-session').update({
        documentId: sessionId, data: { build_layers: layers }
      });
    }

    await strapi.documents('api::brainstorm-session.brainstorm-session').update({
      documentId: sessionId, data: { status: 'building', build_progress: 0 }
    });

    // Create build-step rows for any layer that lacks one.
    const existing = await strapi.documents('api::build-step.build-step').findMany({
      filters: { session: { documentId: sessionId } }
    });
    const existingLayers = new Set((existing || []).map(s => s.layer));
    for (let i = 0; i < layers.length; i++) {
      if (existingLayers.has(layers[i])) continue;
      await strapi.documents('api::build-step.build-step').create({
        data: { session: sessionId, layer: layers[i], status: 'pending', order: i + 1 }
      });
    }

    // 2) Build each layer sequentially, threading prev output_summary forward.
    const prevLayers = {};
    for (const layer of layers) {
      await buildLayer(strapi, sessionId, layer, idea, analysis, arch, qaSummary, prevLayers);
      const steps = await strapi.documents('api::build-step.build-step').findMany({
        filters: { session: { documentId: sessionId }, layer }
      });
      const step = steps[0];
      if (!step || step.status === 'failed') {
        await strapi.documents('api::brainstorm-session.brainstorm-session').update({
          documentId: sessionId, data: { status: 'failed' }
        });
        ctx.status = 502; ctx.body = { error: 'Build failed', detail: step?.error_message || `Layer ${layer} did not complete` };
        return;
      }
      prevLayers[layer] = step.output_summary || '';
    }

    // 3) Push to GitHub (skip gracefully when no PAT is configured — the
    //    generated code is still valid; only the optional delivery is skipped).
    const workspace = workspaceFor(sessionId);
    const slug = sanitizeRepoName(idea.title);
    let repoUrl = null;
    let pushSkipped = false;
    if (githubConfigured()) {
      const result = await createRepoAndPush({
        name: slug, description: idea.description, private: true, files: readAllFiles(workspace)
      });
      repoUrl = result.html_url;
    } else {
      pushSkipped = true;
    }

    // 4) Request deploy (no-op when FORGE_DEPLOY_ENABLED is unset).
    const dep = requestDeploy({ session: sessionId, slug });

    // 5) Mark session + idea complete.
    await strapi.documents('api::brainstorm-session.brainstorm-session').update({
      documentId: sessionId,
      data: { generated_repo_url: repoUrl, status: 'completed', build_progress: 100 }
    });
    await strapi.documents('api::idea.idea').update({
      documentId: idea.documentId, data: { status: 'launched' }
    });
    try { await strapi.documents('api::idea.idea').publish({ documentId: idea.documentId }); } catch {}

    ctx.body = {
      status: 'completed',
      repo_url: repoUrl,
      push_skipped: pushSkipped,
      deploy_url: dep.url,
      deploy_queued: dep.queued
    };
  } catch (err) {
    await strapi.documents('api::brainstorm-session.brainstorm-session').update({
      documentId: sessionId, data: { status: 'failed' }
    });
    ctx.status = 502; ctx.body = { error: 'Pipeline failed', detail: String(err?.message || err) };
  }
}

function generateFallbackFiles(layer, idea, arch) {
  const slug = idea.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const stack = arch?.stack || ['Next.js', 'TypeScript', 'PostgreSQL'];

  switch (layer) {
    case 'database_schema':
      return [
        { path: 'prisma/schema.prisma', content: `generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n\nmodel User {\n  id        String   @id @default(cuid())\n  email     String   @unique\n  name      String?\n  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n}\n` },
        { path: 'prisma/seed.ts', content: `import { PrismaClient } from '@prisma/client';\nconst prisma = new PrismaClient();\n\nasync function main() {\n  console.log('Seeding database...');\n  // Add seed data here\n}\n\nmain().catch(console.error).finally(() => prisma.$disconnect());\n` }
      ];
    case 'api_backend':
      return [
        { path: 'src/index.ts', content: `import express from 'express';\nimport cors from 'cors';\nimport { PrismaClient } from '@prisma/client';\n\nconst app = express();\nconst prisma = new PrismaClient();\n\napp.use(cors());\napp.use(express.json());\n\napp.get('/health', (req, res) => res.json({ status: 'ok' }));\n\n// Add routes here\n\nconst PORT = process.env.PORT || 3001;\napp.listen(PORT, () => console.log(\`Server running on port \${PORT}\`));\n` },
        { path: 'src/routes/index.ts', content: `import { Router } from 'express';\nconst router = Router();\n\n// Add route handlers here\n\nexport default router;\n` }
      ];
    case 'frontend':
      return [
        { path: 'src/app/page.tsx', content: `'use client';\n\nexport default function Home() {\n  return (\n    <main className="min-h-screen p-8">\n      <h1 className="text-3xl font-bold">${idea.title}</h1>\n      <p className="mt-4 text-muted-foreground">${idea.description?.substring(0, 200) || 'Welcome to ' + idea.title}</p>\n    </main>\n  );\n}\n` },
        { path: 'src/app/layout.tsx', content: `import type { Metadata } from 'next';\nimport './globals.css';\n\nexport const metadata: Metadata = {\n  title: '${idea.title}',\n  description: '${idea.description?.substring(0, 160) || ''}',\n};\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang="en">\n      <body>{children}</body>\n    </html>\n  );\n}\n` }
      ];
    case 'auth':
      return [
        { path: 'src/lib/auth.ts', content: `// Auth configuration\nexport const authOptions = {\n  providers: [],\n  // Configure providers here\n};\n` },
        { path: 'src/app/login/page.tsx', content: `'use client';\n\nexport default function LoginPage() {\n  return (\n    <div className="min-h-screen flex items-center justify-center">\n      <div className="p-8 border rounded-lg">\n        <h1 className="text-2xl font-bold">Login</h1>\n        {/* Add login form */}\n      </div>\n    </div>\n  );\n}\n` }
      ];
    case 'docker':
      return [
        { path: 'Dockerfile', content: `FROM node:20-alpine AS base\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\nEXPOSE 3000\nCMD ["npm", "start"]\n` },
        { path: 'docker-compose.yml', content: `services:\n  app:\n    build: .\n    ports:\n      - "3000:3000"\n    environment:\n      - DATABASE_URL=postgresql://user:password@db:5432/${slug}\n    depends_on:\n      - db\n  db:\n    image: postgres:16-alpine\n    environment:\n      - POSTGRES_USER=user\n      - POSTGRES_PASSWORD=password\n      - POSTGRES_DB=${slug}\n    volumes:\n      - pgdata:/var/lib/postgresql/data\nvolumes:\n  pgdata:\n` },
        { path: '.dockerignore', content: `node_modules\n.git\n.env\n*.md\n` }
      ];
    case 'tests':
      return [
        { path: 'tests/app.test.ts', content: `import { describe, it, expect } from 'vitest';\n\ndescribe('${idea.title}', () => {\n  it('should pass basic test', () => {\n    expect(true).toBe(true);\n  });\n});\n` }
      ];
    case 'docs':
      return [
        { path: 'README.md', content: `# ${idea.title}\n\n${idea.description || ''}\n\n## Stack\n\n${stack.join(', ')}\n\n## Getting Started\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\n## Environment Variables\n\nCopy \`.env.example\` to \`.env\` and fill in the values.\n` },
        { path: 'docs/ARCHITECTURE.md', content: `# Architecture\n\n## Stack\n\n${stack.join(', ')}\n\n## Overview\n\n${arch?.description || 'Architecture overview'}\n` }
      ];
    default:
      return [];
  }
}
