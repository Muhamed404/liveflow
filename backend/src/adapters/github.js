import { http, bearer, tlsOf } from './http.js';

const call = (conn, path, opts = {}) =>
  http('github', (conn.base_url || 'https://api.github.com') + path, {
    ...opts,
    headers: {
      authorization: bearer(conn.token),
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'liveflow',
      ...opts.headers,
    },
    tls: tlsOf(conn),
  });

export const github = {
  async test(conn) {
    const { data } = await call(conn, '/user');
    return `authenticated as ${data.login}`;
  },

  async testRepo(conn, repo) {
    const { data } = await call(conn, `/repos/${repo}`);
    if (!data.permissions?.push) throw new Error(`github: token has no push access to ${repo}`);
    return `repo ${data.full_name} (default branch: ${data.default_branch})`;
  },

  async listReleases(conn, repo, limit = 20) {
    const { data } = await call(conn, `/repos/${repo}/releases?per_page=${limit}`);
    return data.map((r) => ({ tag: r.tag_name, name: r.name, target: r.target_commitish, created_at: r.created_at, url: r.html_url }));
  },

  async tagExists(conn, repo, tag) {
    const { status } = await call(conn, `/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`, { allow: [404] });
    return status === 200;
  },

  async createRelease(conn, repo, { tag, target = 'main', notes }) {
    const { data } = await call(conn, `/repos/${repo}/releases`, {
      method: 'POST',
      body: { tag_name: tag, target_commitish: target, name: tag, body: notes || `Release ${tag}`, generate_release_notes: !notes },
    });
    return { tag: data.tag_name, url: data.html_url, created_at: data.created_at };
  },
};
