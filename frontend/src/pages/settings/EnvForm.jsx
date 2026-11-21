import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useEnvConfig, useApiMutation } from '../../api/hooks.js';
import { Text, Pick, ConfirmDialog } from '../../components/forms.jsx';
import { Button, SectionError, Segmented, Pill } from '../../components/ui.jsx';
import { fieldErrors, describeError } from '../../lib/errors.js';

const FIELDS = ['runtime', 'deploy_mode', 'git_branch', 'cluster_id', 'namespace', 'deployment', 'compose_project',
  'jenkins_integration_id', 'jenkins_job', 'argocd_integration_id', 'argocd_app', 'prometheus_integration_id', 'prom_selector',
  'http_metric', 'http_status_label', 'loki_integration_id', 'loki_selector', 'grafana_integration_id', 'grafana_dashboard_uid',
  'stress_job', 'stress_target_url'];
const defaults = (env) => ({ runtime: env === 'dev' ? 'compose' : 'k8s', deploy_mode: env === 'prod' ? 'manual' : 'auto', git_branch: env === 'prod' ? 'main' : env });
const clean = (form) => Object.fromEntries(FIELDS.map((f) => [f, form[f] === '' || form[f] === undefined ? null : form[f]]));

function Group({ title, sub, children }) {
  return <fieldset className="fieldset"><legend>{title}{sub && <span>{sub}</span>}</legend><div className="grid-fields">{children}</div></fieldset>;
}

export function EnvForm({ app, env, integrations, clusters, readOnly }) {
  const qc = useQueryClient();
  const cfg = useEnvConfig(app, env);
  const [form, setForm] = useState(null);
  const [tests, setTests] = useState(null);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  useEffect(() => { if (cfg.isSuccess) setForm(cfg.data ? { ...cfg.data } : defaults(env)); setTests(null); }, [cfg.isSuccess, cfg.data, env]);

  const refresh = [['apps'], ['envconfig', app, env], ['overview', app, env]];
  const save = useApiMutation((body) => api(`/apps/${app}/environments/${env}`, { method: 'PUT', body }), refresh);
  const remove = useApiMutation(() => api(`/apps/${app}/environments/${env}`, { method: 'DELETE' }), refresh);

  if (cfg.isError) return <SectionError what={`${app} / ${env}`} error={cfg.error.message} />;
  if (!form) return <div className="skeleton" style={{ height: 420 }} />;

  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); if (save.isError) save.reset(); };
  const errs = fieldErrors(save.error);
  const of = (type) => integrations.filter((i) => i.type === type).map((i) => ({ value: i.id, label: `${i.name} (${i.id})` }));
  const isNew = !cfg.data;
  const k8s = form.runtime === 'k8s';
  const dis = { disabled: readOnly };

  async function runTest() {
    setTesting(true);
    try { setTests(await api(`/apps/${app}/environments/${env}/test`, { method: 'POST', body: {} })); }
    catch (e) { setTests({ ok: false, checks: [{ tool: 'test', ok: false, message: e.message }] }); }
    finally { setTesting(false); }
  }

  return (
    <form className="panel envform" onSubmit={(e) => { e.preventDefault(); save.mutate(clean(form), { onSuccess: () => qc.invalidateQueries({ queryKey: ['apps'] }) }); }}>
      <div className="panel__head">
        <div>
          <h2 className="panel__title"><span className="mono">{app}</span> / <span className={`envname envname--${env}`}>{env}</span></h2>
          <p className="panel__sub">{isNew ? 'Not set up yet. Fill in where it runs and which tools it uses.' : 'Pick tools by name. Their tokens live in Connections and never show here. Replicas come from the cluster and HPA.'}</p>
        </div>
        {!isNew && <Button icon="plug" disabled={testing} onClick={runTest}>{testing ? 'Testing…' : 'Test environment'}</Button>}
      </div>
      {readOnly && <p className="notice">You can look, but only admins can change settings.</p>}

      {tests && (
        <div className={`testresult${tests.ok ? ' is-ok' : ''}`} role="status">
          <strong>{tests.ok ? 'Everything answered.' : `${tests.checks.filter((c) => !c.ok).length} of ${tests.checks.length} checks failed.`}</strong>
          <ul>
            {tests.checks.map((c) => (
              <li key={c.tool}><Pill tone={c.ok ? 'ok' : 'bad'}>{c.tool}</Pill><span className={c.ok ? '' : 'tone-bad'}>{c.message}</span>{c.latency_ms != null && <span className="hint mono">{c.latency_ms} ms</span>}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid-fields">
        <div className="field"><span className="field__label">Runs on</span>
          <Segmented label="Runtime" value={form.runtime} onChange={readOnly ? () => {} : set('runtime')}
            options={[{ value: 'compose', label: 'Docker Compose' }, { value: 'k8s', label: 'Kubernetes' }]} /></div>
        {k8s && <div className="field"><span className="field__label">Deploys</span>
          {env === 'prod'
            // prod is always behind the gate (the server rejects "auto" for prod)
            ? <span className="hint">Manual sync (gate) — always, for production</span>
            : <Segmented label="Deploy mode" value={form.deploy_mode} onChange={readOnly ? () => {} : set('deploy_mode')}
              options={[{ value: 'auto', label: 'Auto-sync' }, { value: 'manual', label: 'Manual sync (gate)' }]} />}</div>}
      </div>

      {k8s ? (
        <Group title="Kubernetes" sub="Where the workload runs">
          <Pick id="cluster_id" error={errs.cluster_id} label="Cluster" value={form.cluster_id} onChange={set('cluster_id')} options={clusters.map((c) => ({ value: c.id, label: `${c.name} (${c.id})` }))} empty="Choose a cluster" {...dis} />
          <Text id="namespace" error={errs.namespace} label="Namespace" mono value={form.namespace} onChange={set('namespace')} {...dis} />
          <Text id="deployment" error={errs.deployment} label="Deployments" mono value={form.deployment} onChange={set('deployment')}
            placeholder="ui, catalog, cart, orders, checkout" hint="One or more, separated by commas. The first one is the main service: its version and HPA lead the page." {...dis} />
        </Group>
      ) : (
        <Group title="Docker Compose" sub="Containers are read from cAdvisor through Prometheus">
          <Text id="compose_project" error={errs.compose_project} label="Compose project" mono value={form.compose_project} onChange={set('compose_project')}
            hint="The com.docker.compose.project label" {...dis} />
        </Group>
      )}
      <Group title="CI · Jenkins" sub="Stages shown on the dashboard come from this job's Jenkinsfile">
        <Pick id="jenkins_integration_id" error={errs.jenkins_integration_id} label="Jenkins" value={form.jenkins_integration_id} onChange={set('jenkins_integration_id')} options={of('jenkins')} {...dis} />
        <Text id="jenkins_job" error={errs.jenkins_job} label="Job" mono value={form.jenkins_job} onChange={set('jenkins_job')} hint="Folders allowed: team/app-staging" {...dis} />
        <Text id="git_branch" error={errs.git_branch} label="Git branch" mono value={form.git_branch} onChange={set('git_branch')} {...dis} />
      </Group>
      {k8s && (
        <Group title="CD · ArgoCD" sub={form.deploy_mode === 'manual' ? 'Manual sync: the dashboard shows a gate' : 'Auto-sync'}>
          <Pick id="argocd_integration_id" error={errs.argocd_integration_id} label="ArgoCD" value={form.argocd_integration_id} onChange={set('argocd_integration_id')} options={of('argocd')} {...dis} />
          <Text id="argocd_app" error={errs.argocd_app} label="Application" mono value={form.argocd_app} onChange={set('argocd_app')} {...dis} />
        </Group>
      )}
      <Group title="Metrics · Prometheus" sub="Selectors are added to every query">
        <Pick id="prometheus_integration_id" error={errs.prometheus_integration_id} label="Prometheus" value={form.prometheus_integration_id} onChange={set('prometheus_integration_id')} options={of('prometheus')} {...dis} />
        <Text id="prom_selector" error={errs.prom_selector} label="App selector" mono value={form.prom_selector} onChange={set('prom_selector')} hint='e.g. namespace="web-stg",app="web"' {...dis} />
        <Text id="http_metric" error={errs.http_metric} label="Request metric" mono value={form.http_metric} onChange={set('http_metric')} placeholder="http_requests_total" {...dis} />
        <Text id="http_status_label" error={errs.http_status_label} label="Status label" mono value={form.http_status_label} onChange={set('http_status_label')} placeholder="status" hint="promhttp uses code" {...dis} />
      </Group>
      <Group title="Logs and dashboards">
        <Pick id="loki_integration_id" error={errs.loki_integration_id} label="Loki" value={form.loki_integration_id} onChange={set('loki_integration_id')} options={of('loki')} {...dis} />
        <Text id="loki_selector" error={errs.loki_selector} label="Log selector" mono value={form.loki_selector} onChange={set('loki_selector')} hint={k8s ? 'Default: {namespace="<namespace>"}' : 'Default: {compose_project="<project>"}'} {...dis} />
        <Pick id="grafana_integration_id" error={errs.grafana_integration_id} label="Grafana" value={form.grafana_integration_id} onChange={set('grafana_integration_id')} options={of('grafana')} {...dis} />
        <Text id="grafana_dashboard_uid" error={errs.grafana_dashboard_uid} label="Dashboard UID" mono value={form.grafana_dashboard_uid} onChange={set('grafana_dashboard_uid')} {...dis} />
      </Group>
      <Group title="Stress test" sub="A Jenkins k6 job that takes TARGET_URL, VUS and DURATION">
        <Text id="stress_job" error={errs.stress_job} label="k6 job" mono value={form.stress_job} onChange={set('stress_job')} {...dis} />
        <Text id="stress_target_url" error={errs.stress_target_url} label="Target URL" mono value={form.stress_target_url} onChange={set('stress_target_url')} placeholder="http://web.web-stg.svc/" {...dis} />
      </Group>

      {save.isError && <SectionError what="save the environment" verb="Couldn’t" error={describeError(save.error)} />}
      {save.isSuccess && <p className="hint tone-ok" role="status">Saved.</p>}
      {!readOnly && (
        <div className="form-actions">
          {!isNew && <Button kind="danger" onClick={() => setRemoving(true)}>Delete {env}</Button>}
          <button type="submit" className="btn btn--primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : isNew ? `Create ${env}` : 'Save environment'}</button>
        </div>
      )}
      {removing && (
        <ConfirmDialog title={`Delete ${app} / ${env}?`} confirmLabel="Delete environment" tone="danger" confirmWord={env}
          busy={remove.isPending} error={remove.error?.message} onCancel={() => setRemoving(false)}
          onConfirm={() => remove.mutate(undefined, { onSuccess: () => { setRemoving(false); setForm(null); cfg.refetch(); } })}>
          <p>The dashboard forgets this environment. Nothing changes in Jenkins, ArgoCD or the cluster.</p>
        </ConfirmDialog>
      )}
    </form>
  );
}
