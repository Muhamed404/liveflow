// npm run user:create -- <username> <role> [display name]     (password is read from the PASSWORD env var or prompted)
import readline from 'node:readline';
const [username, role = 'admin', ...name] = process.argv.slice(2);
if (!username) { console.error('usage: npm run user:create -- <username> <viewer|operator|admin> [display name]'); process.exit(1); }
const { users, ROLES } = await import('../src/services/auth.js');
if (!ROLES.includes(role)) { console.error(`role must be one of ${ROLES.join(', ')}`); process.exit(1); }
let password = process.env.PASSWORD;
if (!password) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  password = await new Promise((r) => rl.question('Password (min 10 chars): ', (a) => { rl.close(); r(a); }));
}
if (!password || password.length < 10) { console.error('password must be at least 10 characters'); process.exit(1); }
const u = users.create({ username, role, display_name: name.join(' ') || null, password });
console.log(`created ${u.username} (${u.role})`);
