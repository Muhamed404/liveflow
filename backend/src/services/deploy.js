import { jenkins, github, argocd } from '../adapters/index.js';
import { getLatestBuild, getWorkload, getArgo } from './observe.js';
import { invalidate } from '../utils/cache.js';
import { isSemverTag, latestTag, compareTags } from '../utils/semver.js';
import { HttpError } from '../middleware/errors.js';

const safe = (fn) => Promise.resolve().then(fn).catch(() => null);
const bust = (ctx) => invalidate(`${ctx.app.id}:${ctx.env.name}:`);

function needJenkins(ctx) {
  if (!ctx.jenkins) throw new HttpError(400, `no Jenkins job configured for ${ctx.app.id}/${ctx.env.name}`);
}

// Prod actions must be explicit: the dashboard sends confirm=true after the user confirms the dialog
export function requireProdConfirm(ctx, body) {
  if (ctx.env.name === 'prod' && body?.confirm !== true) {
    throw new HttpError(428, 'production action requires "confirm": true');
  }
}

// Two interviewers clicking at once must not start two pipelines
async function ensureNoRunningBuild(ctx) {
  bust(ctx);
  const last = await getLatestBuild(ctx);
  if (last?.status === 'RUNNING') {
    throw new HttpError(409, `pipeline #${last.number} is already running`, { build_number: last.number });
  }
}

/** dev / staging: re-run the branch pipeline (normally triggered by git push / merge) */
export async function triggerBuild(ctx, params = {}) {
  needJenkins(ctx);
  if (ctx.env.name === 'prod') throw new HttpError(400, 'prod deploys go through /releases or /rollback');
  await ensureNoRunningBuild(ctx);
  const res = await jenkins.triggerBuild(ctx.jenkins, ctx.jenkins.job, params);
  bust(ctx);
  return res;
}

/**
 * Releases with their state for the Releases list:
 *   live      — running in the cluster
 *   waiting   — built by Jenkins, ArgoCD not synced yet (prod gate)
 *   building  — Jenkins prod run for this tag in progress
 *   previous  — older tag, can be rolled back to
 */
export async function listReleases(ctx) {
  if (!ctx.github) throw new HttpError(400, 'no GitHub repo configured for this app');
  const [releases, workload, build, argo] = await Promise.all([
    github.listReleases(ctx.github, ctx.github.repo),
    safe(() => getWorkload(ctx)),
    safe(() => getLatestBuild(ctx)),
    safe(() => getArgo(ctx)),
  ]);
  const live = workload?.version || null;
  const built = build?.params?.VERSION || null;
  const pending = build?.status === 'SUCCESS' && built && built !== live && argo?.sync_status === 'OutOfSync' ? built : null;
  const building = build?.status === 'RUNNING' ? built : null;
  const latest = latestTag(releases.map((r) => r.tag));
  return {
    live_version: live,
    pending_version: pending,
    latest_tag: latest,
    suggested_next: latest ? latest.replace(/(\d+)$/, (n) => String(Number(n) + 1)) : 'v1.0.0',
    releases: releases.map((r) => {
      const state = r.tag === live ? 'live' : r.tag === pending ? 'waiting' : r.tag === building ? 'building' : 'previous';
      return { ...r, state, can_rollback: state === 'previous' && isSemverTag(r.tag) };
    }),
  };
}

/**
 * prod release:
 *   1. validate tag (vX.Y.Z, newer than latest, not existing)
 *   2. make sure no pipeline is running
 *   3. GitHub release + tag on the prod branch
 *   4. Jenkins prod job with VERSION + ACTION=release
 * ArgoCD prod is manual-sync: the image tag lands in values-prod.yaml, then the user clicks Sync.
 */
export async function createRelease(ctx, { version, notes }) {
  if (ctx.env.name !== 'prod') throw new HttpError(400, 'versioned releases are for prod; dev/staging deploy from their branches');
  needJenkins(ctx);
  if (!ctx.github) throw new HttpError(400, 'no GitHub repo configured for this app');
  if (!isSemverTag(version)) throw new HttpError(400, 'version must look like v1.2.3');

  const releases = await github.listReleases(ctx.github, ctx.github.repo, 50);
  const latest = latestTag(releases.map((r) => r.tag));
  if (latest && compareTags(version, latest) <= 0) {
    throw new HttpError(400, `version must be newer than ${latest} (use rollback for older versions)`);
  }
  if (await github.tagExists(ctx.github, ctx.github.repo, version)) {
    throw new HttpError(409, `tag ${version} already exists`);
  }
  await ensureNoRunningBuild(ctx);

  const release = await github.createRelease(ctx.github, ctx.github.repo, {
    tag: version, target: ctx.env.git_branch || 'main', notes,
  });
  try {
    const build = await jenkins.triggerBuild(ctx.jenkins, ctx.jenkins.job, { VERSION: version, ACTION: 'release' });
    bust(ctx);
    return { release, ...build };
  } catch (err) {
    err.message = `release ${version} was tagged on GitHub, but Jenkins failed: ${err.message}`;
    throw err;
  }
}

/** Redeploy an existing tag. Jenkins skips the build when the image already exists. */
export async function rollback(ctx, { version }) {
  needJenkins(ctx);
  if (!isSemverTag(version)) throw new HttpError(400, 'version must look like v1.2.3');
  if (!ctx.github || !(await github.tagExists(ctx.github, ctx.github.repo, version))) {
    throw new HttpError(404, `tag ${version} not found`);
  }
  await ensureNoRunningBuild(ctx);
  const res = await jenkins.triggerBuild(ctx.jenkins, ctx.jenkins.job, { VERSION: version, ACTION: 'rollback' });
  bust(ctx);
  return res;
}

/** ArgoCD sync — the manual production gate (also works as "force sync" on staging) */
export async function sync(ctx) {
  if (!ctx.argocd) throw new HttpError(400, 'this environment is not deployed by ArgoCD');
  await argocd.sync(ctx.argocd, ctx.argocd.app);
  bust(ctx);
  return argocd.getApp(ctx.argocd, ctx.argocd.app);
}

export async function queueStatus(ctx, queueId) {
  needJenkins(ctx);
  return jenkins.resolveQueue(ctx.jenkins, queueId);
}

export async function listBuilds(ctx, limit) {
  needJenkins(ctx);
  return jenkins.listBuilds(ctx.jenkins, ctx.jenkins.job, limit);
}

export async function getBuild(ctx, number) {
  needJenkins(ctx);
  return jenkins.getBuild(ctx.jenkins, ctx.jenkins.job, number);
}

export async function getBuildLog(ctx, number, start) {
  needJenkins(ctx);
  return jenkins.getLog(ctx.jenkins, ctx.jenkins.job, number, start);
}
