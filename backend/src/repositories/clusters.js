import { db } from '../db/index.js';
import { updateRow, toBool } from '../db/helpers.js';
import { encrypt, decrypt } from '../crypto/secrets.js';

// Public view: never expose the token, only whether one is set
const PUBLIC = `id, name, api_url, insecure_skip_tls, created_at, updated_at,
  token_enc IS NOT NULL AS has_token, ca_cert IS NOT NULL AS has_ca_cert`;

const shape = (r) => toBool(r, 'insecure_skip_tls', 'has_token', 'has_ca_cert');

export const clustersRepo = {
  list: () => db.prepare(`SELECT ${PUBLIC} FROM clusters ORDER BY name`).all().map(shape),

  get: (id) => shape(db.prepare(`SELECT ${PUBLIC} FROM clusters WHERE id = ?`).get(id)),

  create({ id, name, api_url, token, ca_cert, insecure_skip_tls = false }) {
    db.prepare(`INSERT INTO clusters (id, name, api_url, token_enc, ca_cert, insecure_skip_tls)
                VALUES (@id, @name, @api_url, @token_enc, @ca_cert, @insecure)`)
      .run({ id, name, api_url, token_enc: encrypt(token), ca_cert: ca_cert || null, insecure: insecure_skip_tls ? 1 : 0 });
    return this.get(id);
  },

  update(id, { name, api_url, token, ca_cert, insecure_skip_tls }) {
    updateRow('clusters', { id }, {
      name,
      api_url,
      token_enc: token === undefined ? undefined : encrypt(token),
      ca_cert: ca_cert === undefined ? undefined : ca_cert || null,
      insecure_skip_tls: insecure_skip_tls === undefined ? undefined : insecure_skip_tls ? 1 : 0,
    });
    return this.get(id);
  },

  remove: (id) => db.prepare('DELETE FROM clusters WHERE id = ?').run(id).changes,

  // Internal only (adapters) — includes decrypted token
  getWithSecret(id) {
    const r = db.prepare('SELECT * FROM clusters WHERE id = ?').get(id);
    if (!r) return null;
    return { id: r.id, name: r.name, api_url: r.api_url, ca_cert: r.ca_cert,
      insecure_skip_tls: Boolean(r.insecure_skip_tls), token: decrypt(r.token_enc) };
  },
};
