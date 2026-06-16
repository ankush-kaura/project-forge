// @ts-nocheck
/**
 * Project Forge — deploy request layer.
 *
 * The backend container cannot (and should not) drive Docker on the host
 * directly. Instead it drops a deploy-request manifest into the shared build
 * volume; a host-side watcher (scripts/forge-deploy-watcher.sh) picks it up and:
 *   - docker compose up the generated app on a free port
 *   - creates a <slug>.forge.<domain> DNS A-record via the Hostinger MCP
 *   - writes an nginx vhost proxying the subdomain -> the app port, reloads nginx
 *
 * This keeps the container privilege-free while still giving the owner the
 * "idea -> hosted on a subdomain" outcome.
 *
 * Config (env):
 *   FORGE_BUILD_DOMAIN   base domain for generated apps. default: forge.example.com
 *   FORGE_DEPLOY_ENABLED  '1' to enqueue deploys; otherwise requestDeploy is a no-op.
 */

import * as fs from 'fs';
import * as path from 'path';
import { BUILD_ROOT, workspaceFor } from './verify';

export const DEPLOY_DOMAIN = process.env.FORGE_BUILD_DOMAIN || 'forge.example.com';
export const DEPLOY_ENABLED = process.env.FORGE_DEPLOY_ENABLED === '1';

const QUEUE_DIR = path.join(BUILD_ROOT, '_deploy_queue');

export function subdomainFor(slug: string): string {
  const s = (slug || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'app';
  return `${s}.${DEPLOY_DOMAIN}`;
}

/**
 * Enqueue a deploy. Writes <workspace>/.forge-deploy.json and a queue marker.
 * Returns the expected public URL (whether or not deploy is enabled, so the UI
 * can show the target).
 */
export function requestDeploy(opts: { session: string; slug: string; port?: number }): { url: string; queued: boolean; subdomain: string } {
  const subdomain = subdomainFor(opts.slug);
  const url = `https://${subdomain}`;
  const dir = workspaceFor(opts.session);

  const manifest = {
    session: opts.session,
    slug: opts.slug,
    subdomain,
    url,
    workspace: dir,
    requested_at: new Date().toISOString(),
    status: 'queued',
  };

  if (!DEPLOY_ENABLED) {
    return { url, queued: false, subdomain };
  }

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.forge-deploy.json'), JSON.stringify(manifest, null, 2));
    fs.mkdirSync(QUEUE_DIR, { recursive: true });
    fs.writeFileSync(path.join(QUEUE_DIR, `${manifest.session}.json`), JSON.stringify(manifest, null, 2));
    return { url, queued: true, subdomain };
  } catch (e) {
    return { url, queued: false, subdomain };
  }
}
