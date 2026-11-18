import { db } from '../db/index.js';
import { updateRow, toBool } from '../db/helpers.js';
import { encrypt, decrypt } from '../crypto/secrets.js';

export const INTEGRATION_TYPES = ['jenkins', 'github', 'argocd', 'prometheus', 'grafana', 'loki'];

const PUBLIC = `id, type, name, base_url, username, tenant_id, insecure_skip_tls, created_at, updated_at,
  token_enc IS NOT NULL AS has_token, ca_cert IS NOT NULL AS has_ca_cert`;
const shape = (r) => toBool(r, 'has_token', 'has_ca_cert', 'insecure_skip_tls');

export const integrationsRepo = {
  list(type) {
    if (type) return db.prepare(`SELECT ${PUBLIC} FROM integrations WHERE type = ? ORDER BY name`).all(type).map(shape);
    return db.prepare(`SELECT ${PUBLIC} FROM integrations ORDER BY type, name`).all().map(shape);
  },

  get: (id) => shape(db.prepare(`SELECT ${PUBLIC} FROM integrations WHERE id = ?`).get(id)),

  create({ id, type, name, base_url, username, token, ca_cert, insecure_skip_tls = false, tenant_id }) {
    db.prepare(`INSERT INTO integrations (id, type, name, base_url, username, token_enc, ca_cert, insecure_skip_tls, tenant_id)
                VALUES (@id, @type, @name, @base_url, @username, @token_enc, @ca_cert, @insecure, @tenant_id)`)
      .run({ id, type, name, base_url: base_url.replace(/\/+$/, ''), username: username || null, token_enc: encrypt(token),
        ca_cert: ca_cert || null, insecure: insecure_skip_tls ? 1 : 0, tenant_id: tenant_id || null });
    return this.get(id);
  },

  update(id, { name, base_url, username, token, ca_cert, insecure_skip_tls, tenant_id }) {
    updateRow('integrations', { id }, {
      name,
      base_url: base_url?.replace(/\/+$/, ''),
      username: username === undefined ? undefined : username || null,
      token_enc: token === undefined ? undefined : encrypt(token),
      ca_cert: ca_cert === undefined ? undefined : ca_cert || null,
      insecure_skip_tls: insecure_skip_tls === undefined ? undefined : insecure_skip_tls ? 1 : 0,
      tenant_id: tenant_id === undefined ? undefined : tenant_id || null,
    });
    return this.get(id);
  },

  remove: (id) => db.prepare('DELETE FROM integrations WHERE id = ?').run(id).changes,

  getWithSecret(id) {
    if (!id) return null;
    const r = db.prepare('SELECT * FROM integrations WHERE id = ?').get(id);
    if (!r) return null;
    return {
      id: r.id, type: r.type, name: r.name, base_url: r.base_url, username: r.username, token: decrypt(r.token_enc),
      tenant_id: r.tenant_id, tls: { ca: r.ca_cert, insecure: Boolean(r.insecure_skip_tls) },
    };
  },
};
