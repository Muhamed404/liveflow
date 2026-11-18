import { http, basic, tlsOf } from './http.js';

// wfapi stage status -> UI state
const STAGE_STATE = {
  SUCCESS: 'ok', IN_PROGRESS: 'running', FAILED: 'failed', ABORTED: 'failed',
  UNSTABLE: 'failed', NOT_EXECUTED: 'pending', PAUSED_PENDING_INPUT: 'running',
};

// Optional contract: Jenkinsfile sets currentBuild.description = "image=registry/app:tag"
const imageFrom = (description) => /image\s*[=:]\s*(\S+)/i.exec(description || '')?.[1] || null;

// "folder/my-job" -> "/job/folder/job/my-job"
const jobPath = (job) => job.split('/').filter(Boolean).map((j) => `/job/${encodeURIComponent(j)}`).join('');

const auth = (conn) => ({ authorization: basic(conn.username, conn.token) });
const crumbs = new Map(); // conn.id -> { field, value }

async function fetchCrumb(conn) {
  const { data } = await http('jenkins', `${conn.base_url}/crumbIssuer/api/json`, { headers: auth(conn), tls: tlsOf(conn) });
  const c = { field: data.crumbRequestField, value: data.crumb };
  crumbs.set(conn.id, c);
  return c;
}

// API tokens normally skip CSRF. Some Jenkins setups still demand a crumb on POST: fetch one and retry once.
async function call(conn, path, opts = {}) {
  const crumb = opts.method === 'POST' ? crumbs.get(conn.id) : null;
  const headers = { ...auth(conn), ...(crumb ? { [crumb.field]: crumb.value } : {}), ...opts.headers };
  try {
    return await http('jenkins', conn.base_url + path, { ...opts, headers, tls: tlsOf(conn) });
  } catch (err) {
    const crumbProblem = err.upstreamStatus === 403 && /crumb/i.test(err.details?.body || '');
    if (opts.method !== 'POST' || !crumbProblem || opts.__retried) throw err;
    const c = await fetchCrumb(conn);
    return call(conn, path, { ...opts, __retried: true, headers: { ...opts.headers, [c.field]: c.value } });
  }
}

export const jenkins = {
  async test(conn) {
    const { data } = await call(conn, '/me/api/json');
    return `authenticated as ${data.id || data.fullName}`;
  },

  async testJob(conn, job) {
    const { data } = await call(conn, `${jobPath(job)}/api/json?tree=name,buildable`);
    return `job "${data.name}" found`;
  },

  /** Queue a build. Returns the queue item id. */
  async triggerBuild(conn, job, params = {}) {
    const hasParams = Object.keys(params).length > 0;
    const path = `${jobPath(job)}/${hasParams ? 'buildWithParameters' : 'build'}`;
    const res = await call(conn, path, { method: 'POST', form: hasParams ? params : undefined });
    const m = /\/queue\/item\/(\d+)/.exec(res.headers.location || '');
    return { queue_id: m ? Number(m[1]) : null };
  },

  /** Queue item -> build number once the build started (null while still waiting). */
  async resolveQueue(conn, queueId) {
    const { data } = await call(conn, `/queue/item/${queueId}/api/json`);
    return {
      build_number: data.executable?.number ?? null,
      waiting_reason: data.why || null,
      cancelled: Boolean(data.cancelled),
    };
  },

  /** Build status + stages (stages need the Pipeline Stage View plugin). */
  async getBuild(conn, job, build = 'lastBuild') {
    const base = `${jobPath(job)}/${build}`;
    const tree = 'number,result,building,timestamp,duration,description,'
      + 'actions[parameters[name,value],causes[shortDescription,userName,userId],lastBuiltRevision[SHA1,branch[name]]]';
    const { data } = await call(conn, `${base}/api/json?tree=${tree}`);
    const actions = data.actions || [];
    const params = actions.flatMap((a) => a?.parameters || []);
    const cause = actions.flatMap((a) => a?.causes || [])[0] || null;
    const rev = actions.find((a) => a?.lastBuiltRevision)?.lastBuiltRevision || null;

    let stages = null;
    const wf = await call(conn, `${base}/wfapi/describe`, { allow: [404] });
    if (wf.status === 200 && Array.isArray(wf.data.stages)) {
      stages = wf.data.stages.map((s) => ({
        name: s.name,
        state: STAGE_STATE[s.status] || 'pending',
        duration_ms: s.durationMillis ?? null,
      }));
    }
    const p = Object.fromEntries(params.map((x) => [x.name, x.value]));
    const status = data.building ? 'RUNNING' : data.result || 'UNKNOWN';
    const startedMs = data.timestamp || null;
    return {
      number: data.number,
      status,
      started_at: startedMs ? new Date(startedMs).toISOString() : null,
      finished_at: !data.building && startedMs && data.duration ? new Date(startedMs + data.duration).toISOString() : null,
      // a running build reports duration 0 -> compute elapsed so the UI can show "1m 40s so far"
      duration_ms: data.building && startedMs ? Date.now() - startedMs : data.duration,
      params: p,
      trigger: cause ? { text: cause.shortDescription || null, user: cause.userName || cause.userId || null } : null,
      commit: rev?.SHA1 ? { sha: rev.SHA1, short: rev.SHA1.slice(0, 7), branch: rev.branch?.[0]?.name?.replace(/^(refs\/remotes\/)?origin\//, '') || null } : null,
      image: imageFrom(data.description),
      current_stage: stages?.find((s) => s.state === 'running')?.name || null,
      stages,
    };
  },

  async listBuilds(conn, job, limit = 10) {
    const { data } = await call(conn, `${jobPath(job)}/api/json?tree=builds[number,result,building,timestamp,duration]{0,${limit}}`);
    return (data.builds || []).map((b) => ({
      number: b.number,
      status: b.building ? 'RUNNING' : b.result || 'UNKNOWN',
      started_at: new Date(b.timestamp).toISOString(),
      // Jenkins reports 0 while a build runs: use elapsed time instead
      duration_ms: b.building ? Date.now() - b.timestamp : b.duration,
    }));
  },

  async stopBuild(conn, job, build) {
    await call(conn, `${jobPath(job)}/${build}/stop`, { method: 'POST', allow: [302] });
    return { stopped: true };
  },

  /** Incremental console log. Call again with next_start while more is true. */
  async getLog(conn, job, build, start = 0) {
    const res = await call(conn, `${jobPath(job)}/${build}/logText/progressiveText?start=${start}`, { headers: { accept: 'text/plain' } });
    return {
      text: typeof res.data === 'string' ? res.data : String(res.data),
      next_start: Number(res.headers['x-text-size'] || start),
      more: res.headers['x-more-data'] === 'true',
    };
  },
};
