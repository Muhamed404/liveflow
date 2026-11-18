import { jenkins } from './jenkins.js';
import { github } from './github.js';
import { argocd } from './argocd.js';
import { prometheus } from './prometheus.js';
import { loki } from './loki.js';
import { grafana } from './grafana.js';
import { k8s } from './k8s.js';

export const adapters = { jenkins, github, argocd, prometheus, loki, grafana, k8s };
export { jenkins, github, argocd, prometheus, loki, grafana, k8s };
