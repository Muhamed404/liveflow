/**
 * Builds the "delivery path" the UI draws across the top of every env page.
 * The frontend only renders it: which stations exist, their state, and the rails between them.
 *
 *   k8s:     github -> jenkins -> argocd -> cluster
 *   compose: github -> jenkins -> dev_server
 *
 * Every station is backed by a real API (no inferred stations).
 * state: done | active | gate | fail | idle | unknown
 */

const isRunning = (b) => b?.status === 'RUNNING';
const isOk = (b) => b?.status === 'SUCCESS';
const isFailed = (b) => ['FAILURE', 'ABORTED', 'UNSTABLE'].includes(b?.status);

function githubStation(ctx, build) {
  const st = { id: 'github', name: 'GitHub', state: 'idle', status: 'No runs yet', detail: ctx.github?.repo || null };
  if (!build) return st;
  const version = build.params?.VERSION;
  st.state = 'done';
  if (version) {
    st.status = build.params.ACTION === 'rollback' ? `Rollback to ${version}` : `Tagged ${version}`;
    st.detail = `on ${ctx.env.git_branch || 'main'}`;
  } else if (build.commit) {
    st.status = 'Changes picked up';
    st.detail = `${build.commit.short} → ${build.commit.branch || ctx.env.git_branch || ctx.env.name}`;
  } else {
    st.status = 'Triggered';
    st.detail = build.trigger?.text || null;
  }
  st.trigger = build.trigger;
  return st;
}

function jenkinsStation(build, error) {
  const st = { id: 'jenkins', name: 'Jenkins', state: 'idle', status: 'No runs yet', detail: null, build_number: null, stages: null, current_stage: null, image: null };
  if (error) return { ...st, state: 'unknown', status: 'Unavailable', detail: error };
  if (!build) return st;
  Object.assign(st, { build_number: build.number, stages: build.stages, current_stage: build.current_stage, image: build.image, duration_ms: build.duration_ms });
  if (isRunning(build)) {
    st.state = 'active';
    st.status = `#${build.number} running`;
    st.detail = build.current_stage || 'starting';
  } else if (isOk(build)) {
    st.state = 'done';
    st.status = `#${build.number} passed`;
    st.detail = build.image ? `pushed ${build.image.split(':').pop()}` : null;
  } else if (isFailed(build)) {
    st.state = 'fail';
    const failedStage = build.stages?.find((s) => s.state === 'failed')?.name;
    st.status = `#${build.number} ${build.status.toLowerCase()}`;
    st.detail = failedStage ? `at ${failedStage}` : null;
  } else {
    st.state = 'unknown';
    st.status = `#${build.number} ${build.status}`;
  }
  return st;
}

function argoStation(ctx, argo, error, upstreamBusy) {
  const st = { id: 'argocd', name: 'ArgoCD', state: 'idle', status: '', detail: ctx.argocd.app, auto_sync: ctx.env.deploy_mode === 'auto' };
  if (error) return { ...st, state: 'unknown', status: 'Unavailable', detail: error };
  if (!argo) return st;
  Object.assign(st, { sync_status: argo.sync_status, health_status: argo.health_status });
  const syncing = argo.operation?.phase === 'Running';
  if (syncing) return { ...st, state: 'active', status: 'Syncing' };
  // downstream of a running build: real status kept in sync_status, but the station waits its turn
  if (upstreamBusy) return { ...st, state: 'idle', status: 'Waits for Jenkins', detail: `now: ${argo.sync_status}` };
  if (argo.sync_status === 'OutOfSync') {
    if (ctx.env.deploy_mode === 'manual') return { ...st, state: 'gate', status: 'Waiting for approval', detail: 'OutOfSync · manual' };
    return { ...st, state: 'active', status: 'OutOfSync' };
  }
  if (argo.health_status === 'Degraded' || argo.health_status === 'Missing') return { ...st, state: 'fail', status: argo.health_status };
  if (argo.health_status === 'Progressing') return { ...st, state: 'active', status: 'Synced · progressing' };
  return { ...st, state: 'done', status: `Synced · ${argo.auto_sync ? 'auto' : 'manual'}` };
}

function workloadStation(ctx, w, error) {
  const isK8s = ctx.env.runtime === 'k8s';
  const st = {
    rolling_out: false,
    id: isK8s ? 'cluster' : 'dev_server',
    name: isK8s ? (ctx.env.name === 'prod' ? 'Production' : 'Cluster') : 'Dev server',
    state: 'idle', status: '', detail: isK8s ? ctx.k8s.cluster?.name || ctx.k8s.cluster?.id : ctx.compose.project,
    instances: [],
  };
  if (error) return { ...st, state: 'unknown', status: 'Unavailable', detail: error };
  if (!w) return st;
  // squares in the UI: new | old | starting | terminating | stopped
  st.instances = w.instances.map((p) => ({
    name: p.name,
    look: p.phase === 'Terminating' ? 'terminating'
      : !p.ready ? (p.phase === 'Stopped' ? 'stopped' : 'starting')
      : p.current ? 'new' : 'old',
    version: p.version,
    service: p.service || null,
  }));
  st.version = w.version;
  // one line per service (the UI groups the pod squares by it when there is more than one)
  st.services = (w.services || []).map((s) => ({
    name: s.name, version: s.version, ready: s.replicas.ready, desired: s.replicas.desired,
    on_new: s.replicas.on_current_version, rolling_out: s.rolling_out,
  }));
  if (st.services.length > 1 && !error) st.detail = `${st.detail} · ${st.services.length} services`;
  const { desired, ready, on_current_version: onNew } = w.replicas;
  const rolling = (w.services || []).filter((s) => s.rolling_out);
  // a service with 0 desired replicas serves nothing: never "done" (0 / 0 used to look healthy)
  const atZero = (w.services || []).filter((s) => s.replicas.desired === 0);
  if (desired === 0 || (atZero.length && atZero.length === (w.services || []).length)) {
    st.state = 'fail';
    st.status = isK8s ? 'Scaled to 0' : 'No containers running';
  } else if (atZero.length) {
    st.state = 'fail';
    st.status = `${atZero.map((s) => s.name).join(', ')} scaled to 0`;
  } else if (w.rolling_out) {
    st.rolling_out = true;
    st.state = 'active';
    // name the service when it is the only one rolling: "Rolling out cart 1 / 3"
    st.status = rolling.length === 1 && st.services.length > 1
      ? `Rolling out ${rolling[0].name} ${rolling[0].replicas.on_current_version} / ${rolling[0].replicas.desired}`
      : `Rolling out ${onNew} / ${desired}`;
  } else if (ready < desired) {
    st.state = 'active';
    st.status = `${ready} / ${desired} ready`;
  } else {
    st.state = 'done';
    st.status = `${w.version || 'live'} · ${ready} / ${desired}`;
  }
  return st;
}

const railFor = (next) => ({ done: 'done', active: 'active', gate: 'blocked', fail: 'done', idle: 'idle', unknown: 'idle' }[next.state]);

/** sections = the settled overview sections: { workload, pipeline, argocd } each {data} | {error} */
export function buildPath(ctx, sections) {
  const build = sections.pipeline?.data || null;
  const stations = [githubStation(ctx, build), jenkinsStation(build, sections.pipeline?.error)];
  if (ctx.env.runtime === 'k8s' && ctx.argocd) {
    stations.push(argoStation(ctx, sections.argocd?.data, sections.argocd?.error, isRunning(build)));
  }
  stations.push(workloadStation(ctx, sections.workload?.data, sections.workload?.error));

  const rails = stations.slice(1).map(railFor);
  // phase: one word the UI turns into the headline ("stg-d41e0a7 is rolling out", "v2.2.0 is waiting on you" ...)
  const by = Object.fromEntries(stations.map((s) => [s.id, s]));
  const wl = by.cluster || by.dev_server;
  let phase = 'live';
  if (by.jenkins.state === 'active') phase = 'building';
  else if (by.jenkins.state === 'fail') phase = 'failed';
  else if (by.argocd?.state === 'gate') phase = 'waiting_gate';
  else if (by.argocd?.state === 'active') phase = 'deploying';
  else if (wl.rolling_out) phase = 'rolling_out';
  else if (wl.state === 'active') phase = 'scaling';
  else if (wl.state === 'fail' || by.argocd?.state === 'fail') phase = 'unhealthy';
  else if (!build) phase = 'idle';

  return { phase, stations, rails };
}
