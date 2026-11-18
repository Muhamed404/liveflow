import { jenkins } from '../adapters/index.js';
import { HttpError } from '../middleware/errors.js';
import { invalidate } from '../utils/cache.js';
import { activity } from './activity.js';

export const STRESS_LIMITS = { vus: [1, 500], duration_sec: [10, 600] };

function needStress(ctx) {
  if (!ctx.stress) throw new HttpError(400, 'no stress job configured for this environment');
}

async function lastStress(ctx) {
  try {
    return await jenkins.getBuild(ctx.stress, ctx.stress.job, 'lastBuild');
  } catch (err) {
    if (err.upstreamStatus === 404) return null;
    throw err;
  }
}

/** Starts the k6 Jenkins job. The HPA reaction is watched through /workload + /metrics. */
export async function startStress(ctx, { vus, duration_sec }) {
  needStress(ctx);
  const last = await lastStress(ctx);
  if (last?.status === 'RUNNING') throw new HttpError(409, `stress test #${last.number} is already running`);
  const res = await jenkins.triggerBuild(ctx.stress, ctx.stress.job, {
    TARGET_URL: ctx.stress.target_url,
    VUS: String(vus),
    DURATION: `${duration_sec}s`,
  });
  invalidate(`${ctx.app.id}:${ctx.env.name}:`);
  return { ...res, vus, duration_sec, target_url: ctx.stress.target_url };
}

export async function stressStatus(ctx) {
  needStress(ctx);
  const last = await lastStress(ctx);
  if (!last) return { running: false, build: null, target_url: ctx.stress.target_url, limits: STRESS_LIMITS };
  const durationSec = parseInt(last.params?.DURATION, 10) || null;
  const elapsedSec = last.started_at ? Math.max(0, Math.round((Date.now() - Date.parse(last.started_at)) / 1000)) : null;
  const starter = activity.list({ app_id: ctx.app.id, env: ctx.env.name, limit: 50 }).find((a) => a.action === 'stress_start' && a.status === 'ok');
  return {
    running: last.status === 'RUNNING',
    build: last,
    vus: Number(last.params?.VUS) || null,
    duration_sec: durationSec,
    elapsed_sec: elapsedSec,
    remaining_sec: last.status === 'RUNNING' && durationSec != null ? Math.max(0, durationSec - elapsedSec) : 0,
    started_by: starter?.actor || last.trigger?.user || null,
    target_url: ctx.stress.target_url,
    limits: STRESS_LIMITS,
  };
}

export async function stopStress(ctx) {
  needStress(ctx);
  const last = await lastStress(ctx);
  if (last?.status !== 'RUNNING') throw new HttpError(409, 'no stress test is running');
  await jenkins.stopBuild(ctx.stress, ctx.stress.job, last.number);
  return { stopped: last.number };
}
