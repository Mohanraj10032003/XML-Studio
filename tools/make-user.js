// Usage:  npm run user -- <username> <password>
// Prints a JSON entry; paste it into the "users" array of src/assets/auth.json
const crypto = require('crypto');
const [, , username, password] = process.argv;
if (!username || !password) {
  console.error('Usage: npm run user -- <username> <password>');
  process.exit(1);
}
const ITER = 10000; // keep in sync with "iterations" in auth.json
const salt = crypto.randomBytes(12).toString('hex');
const sha = (b) => crypto.createHash('sha256').update(b).digest();
let h = sha(Buffer.from(`${salt}:${password}`, 'utf8'));
const pw = Buffer.from(password, 'utf8');
for (let i = 0; i < ITER; i++) h = sha(Buffer.concat([h, pw]));
console.log(JSON.stringify({ username, salt, hash: h.toString('hex') }, null, 2));
