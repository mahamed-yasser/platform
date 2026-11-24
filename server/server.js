// E-Sentry backend PROTOTYPE: zero-dependency Node server (node:sqlite).
// Real server-side auth + authorization. Prototype only: see README.md for limits.
const http = require("http");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 3100;
const DB_FILE = process.env.DB_FILE || ":memory:";
const db = new DatabaseSync(DB_FILE);
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student', pw TEXT NOT NULL, created INTEGER);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS results(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, exam_id TEXT NOT NULL, score INTEGER NOT NULL, total INTEGER NOT NULL, percentage INTEGER NOT NULL, answers TEXT NOT NULL, created INTEGER);
CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created INTEGER);
CREATE TABLE IF NOT EXISTS answers(id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, content TEXT NOT NULL, created INTEGER);
`);
try { db.exec("ALTER TABLE posts ADD COLUMN category TEXT NOT NULL DEFAULT 'عام'"); } catch (e) {}
const FORUM_CATS = ["الأمن السيبراني", "أمن الشبكات", "التشفير", "ثغرات الويب", "عام"];

const scryptHash = (pw, salt = crypto.randomBytes(16).toString("hex")) =>
  `scrypt$${salt}$${crypto.scryptSync(pw, salt, 32).toString("hex")}`;
const scryptVerify = (pw, stored) => {
  const [, salt, h] = stored.split("$");
  const a = Buffer.from(h, "hex"), b = crypto.scryptSync(pw, salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

// Admin is created from env at startup. No default password exists.
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 12) {
  db.prepare("INSERT OR IGNORE INTO users(email,name,role,pw,created) VALUES(?,?,?,?,?)")
    .run(process.env.ADMIN_EMAIL.toLowerCase(), "Admin", "admin", scryptHash(process.env.ADMIN_PASSWORD), Date.now());
}

// Exams: the answer key stays on the server. Loaded from the demo data file at startup (prototype source of truth).
const vm = require("vm");
const EXAMS = (() => {
  try {
    const c = { window: {}, localStorage: { getItem() { return null; }, setItem() {} }, console };
    vm.createContext(c);
    vm.runInContext(require("fs").readFileSync(require("path").join(__dirname, "..", "js", "data.js"), "utf8") + ";globalThis.__E=INITIAL_EXAMS", c);
    return c.__E || [];
  } catch (e) { return []; }
})();
const publicExam = (e) => ({ id: e.id, title: e.title, unit: e.unit, duration: e.duration, totalQuestions: e.questions.length,
  questions: e.questions.map((q) => ({ id: q.id, question: q.question, options: q.options })) });

// Rate limit per IP+route (in memory, prototype)
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now(); const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(key, arr); return arr.length > max;
}

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'",
};
const send = (res, code, obj, extra = {}) => { res.writeHead(code, { ...HEADERS, ...extra }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((ok, no) => {
  let d = ""; req.on("data", (c) => { d += c; if (d.length > 20000) { no(new Error("big")); req.destroy(); } });
  req.on("end", () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { no(e); } });
});
const cookie = (req, n) => (req.headers.cookie || "").split(/;\s*/).map((c) => c.split("=")).find((p) => p[0] === n)?.[1];
const str = (v, min, max) => typeof v === "string" && v.trim().length >= min && v.trim().length <= max;
const user = (req) => {
  const t = cookie(req, "sid"); if (!t) return null;
  const row = db.prepare("SELECT u.id,u.email,u.name,u.role,s.expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?").get(sha(t));
  if (!row || row.expires < Date.now()) return null; return row;
};
const sessionCookie = (token, maxAge) => `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;

const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
// Server mode never serves the answer key: js/data.js is sent with correctAnswer and explanation lines removed.
// (The key stays on the server only, loaded above for scoring.)
const DATA_FILE = path.resolve(ROOT, "js", "data.js");
const STRIPPED_DATA = fs.readFileSync(DATA_FILE, "utf8").replace(/^[ \t]*"(correctAnswer|explanation)"\s*:.*\r?\n/gm, "");
function serveStatic(req, res, p) {
  const rel = p === "/" ? "/index.html" : p; const file = path.resolve(ROOT, "." + decodeURIComponent(rel));
  const ext = path.extname(file);
  // only allow known web file types inside the site folder, never server/ or dotfiles
  if (!file.startsWith(ROOT + path.sep) || file.startsWith(path.join(ROOT, "server")) || path.basename(file).startsWith(".") || !MIME[ext] || !fs.existsSync(file)) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
  if (file === DATA_FILE) { res.writeHead(200, { "Content-Type": MIME[ext], "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" }); return res.end(STRIPPED_DATA); }
  res.writeHead(200, { "Content-Type": MIME[ext], "X-Content-Type-Options": "nosniff" }); fs.createReadStream(file).pipe(res);
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x"); const ip = req.socket.remoteAddress; const p = url.pathname;
    if (req.method === "GET" && !p.startsWith("/api/")) return serveStatic(req, res, p);
    // CSRF: state-changing requests must be same-origin JSON
    if (req.method !== "GET" && !(req.headers["content-type"] || "").startsWith("application/json")) return send(res, 415, { error: "json_only" });
    if (req.method !== "GET" && req.headers.origin && req.headers.host && new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, { error: "bad_origin" });

    if (req.method === "POST" && p === "/api/register") {
      if (limited("reg" + ip, 10, 60000)) return send(res, 429, { error: "rate_limited" });
      const b = await readBody(req);
      if (!str(b.name, 2, 80) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email || "") || !str(b.password, 10, 200)) return send(res, 400, { error: "invalid_input" });
      try {
        // role is ALWAYS student here, any role in the request body is ignored
        db.prepare("INSERT INTO users(email,name,role,pw,created) VALUES(?,?,'student',?,?)").run(b.email.toLowerCase(), b.name.trim(), scryptHash(b.password), Date.now());
      } catch (e) { return send(res, 409, { error: "email_taken" }); }
      return send(res, 201, { ok: true });
    }
    if (req.method === "POST" && p === "/api/login") {
      if (limited("login" + ip, 5, 60000)) return send(res, 429, { error: "rate_limited" });
      const b = await readBody(req);
      const u = typeof b.email === "string" ? db.prepare("SELECT * FROM users WHERE email=?").get(b.email.toLowerCase()) : null;
      const ok = u && typeof b.password === "string" && scryptVerify(b.password, u.pw);
      if (!ok) return send(res, 401, { error: "bad_credentials" });
      const token = crypto.randomBytes(32).toString("hex");
      db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(sha(token), u.id, Date.now() + 7 * 864e5);
      return send(res, 200, { ok: true, name: u.name, role: u.role }, { "Set-Cookie": sessionCookie(token, 7 * 86400) });
    }
    if (req.method === "POST" && p === "/api/logout") {
      const t = cookie(req, "sid"); if (t) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(sha(t));
      return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
    }
    const me = user(req);
    if (req.method === "GET" && p === "/api/me") return me ? send(res, 200, { name: me.name, email: me.email, role: me.role }) : send(res, 401, { error: "unauthenticated" });
    if (!me) return send(res, 401, { error: "unauthenticated" });

    if (req.method === "GET" && p === "/api/posts") {
      const rows = me.role === "admin"
        ? db.prepare("SELECT p.id,p.title,p.content,p.category,p.status,p.created,p.user_id,u.name author FROM posts p JOIN users u ON u.id=p.user_id ORDER BY p.id DESC").all()
        : db.prepare("SELECT p.id,p.title,p.content,p.category,p.status,p.created,p.user_id,u.name author FROM posts p JOIN users u ON u.id=p.user_id WHERE p.status='approved' OR p.user_id=? ORDER BY p.id DESC").all(me.id);
      const q = db.prepare("SELECT a.id,a.content,a.created,u.name author FROM answers a JOIN users u ON u.id=a.user_id WHERE a.post_id=? ORDER BY a.id");
      return send(res, 200, { posts: rows.map((r) => ({ id: r.id, title: r.title, content: r.content, category: r.category, status: r.status, created: r.created, author: r.author, mine: r.user_id === me.id, answers: q.all(r.id) })) });
    }
    if (req.method === "POST" && p === "/api/posts") {
      if (limited("post" + me.id, 10, 60000)) return send(res, 429, { error: "rate_limited" });
      const b = await readBody(req);
      if (!str(b.title, 3, 150) || !str(b.content, 3, 3000)) return send(res, 400, { error: "invalid_input" });
      const cat = FORUM_CATS.includes(b.category) ? b.category : "عام";
      const r = db.prepare("INSERT INTO posts(user_id,title,content,category,created) VALUES(?,?,?,?,?)").run(me.id, b.title.trim(), b.content.trim(), cat, Date.now());
      return send(res, 201, { id: Number(r.lastInsertRowid), status: "pending" });
    }
    let m;
    if (req.method === "GET" && p === "/api/exams") return send(res, 200, { exams: EXAMS.map(publicExam) });
    if (req.method === "POST" && (m = p.match(/^\/api\/exams\/([\w-]+)\/submit$/))) {
      const exam = EXAMS.find((e) => e.id === m[1]);
      if (!exam) return send(res, 404, { error: "not_found" });
      if (limited("exam" + me.id, 10, 60000)) return send(res, 429, { error: "rate_limited" });
      const b = await readBody(req);
      if (!b.answers || typeof b.answers !== "object" || Array.isArray(b.answers)) return send(res, 400, { error: "invalid_input" });
      const clean = {};
      for (const q of exam.questions) {
        const a = b.answers[q.id];
        if (a === undefined) continue;
        if (!Number.isInteger(a) || a < 0 || a >= q.options.length) return send(res, 400, { error: "invalid_input" });
        clean[q.id] = a;
      }
      if (db.prepare("SELECT 1 FROM results WHERE user_id=? AND exam_id=?").get(me.id, exam.id)) return send(res, 409, { error: "already_submitted" });
      const total = exam.questions.length;
      const score = exam.questions.filter((q) => clean[q.id] === q.correctAnswer).length;
      const percentage = Math.round((score / total) * 100);
      db.prepare("INSERT INTO results(user_id,exam_id,score,total,percentage,answers,created) VALUES(?,?,?,?,?,?,?)").run(me.id, exam.id, score, total, percentage, JSON.stringify(clean), Date.now());
      // One attempt per exam. The review never reveals the key for questions answered wrong or skipped,
      // so a submission cannot be used to read the answer sheet.
      return send(res, 200, { score, total, percentage, passed: percentage >= 60,
        review: exam.questions.map((q) => { const ok = clean[q.id] === q.correctAnswer; return ok ? { id: q.id, correct: true, explanation: q.explanation } : { id: q.id, correct: false, yours: clean[q.id] ?? null }; }) });
    }
    if (req.method === "GET" && p === "/api/results") {
      const rows = db.prepare("SELECT exam_id,score,total,percentage,created FROM results WHERE user_id=? ORDER BY id DESC").all(me.id);
      return send(res, 200, { results: rows });
    }
    if (req.method === "GET" && p === "/api/admin/results") {
      if (me.role !== "admin") return send(res, 403, { error: "forbidden" });
      return send(res, 200, { results: db.prepare("SELECT r.exam_id,r.score,r.total,r.percentage,u.email FROM results r JOIN users u ON u.id=r.user_id ORDER BY r.id DESC").all() });
    }
    if (req.method === "POST" && (m = p.match(/^\/api\/posts\/(\d+)\/approve$/))) {
      if (me.role !== "admin") return send(res, 403, { error: "forbidden" });
      db.prepare("UPDATE posts SET status='approved' WHERE id=?").run(Number(m[1])); return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && (m = p.match(/^\/api\/posts\/(\d+)\/answers$/))) {
      if (limited("ans" + me.id, 20, 60000)) return send(res, 429, { error: "rate_limited" });
      const b = await readBody(req);
      if (!str(b.content, 1, 2000)) return send(res, 400, { error: "invalid_input" });
      const post = db.prepare("SELECT user_id,status FROM posts WHERE id=?").get(Number(m[1]));
      if (!post || (post.status !== "approved" && post.user_id !== me.id && me.role !== "admin")) return send(res, 404, { error: "not_found" });
      const r = db.prepare("INSERT INTO answers(post_id,user_id,content,created) VALUES(?,?,?,?)").run(Number(m[1]), me.id, b.content.trim(), Date.now());
      return send(res, 201, { id: Number(r.lastInsertRowid) });
    }
    if (req.method === "DELETE" && (m = p.match(/^\/api\/posts\/(\d+)$/))) {
      const post = db.prepare("SELECT user_id FROM posts WHERE id=?").get(Number(m[1]));
      if (!post) return send(res, 404, { error: "not_found" });
      if (post.user_id !== me.id && me.role !== "admin") return send(res, 403, { error: "forbidden" });
      db.prepare("DELETE FROM answers WHERE post_id=?").run(Number(m[1])); db.prepare("DELETE FROM posts WHERE id=?").run(Number(m[1])); return send(res, 200, { ok: true });
    }
    if (req.method === "GET" && p === "/api/admin/users") {
      if (me.role !== "admin") return send(res, 403, { error: "forbidden" });
      return send(res, 200, { users: db.prepare("SELECT id,email,name,role FROM users").all() });
    }
    return send(res, 404, { error: "not_found" });
  } catch (e) { return send(res, 400, { error: "bad_request" }); }
});
module.exports = { server };
if (require.main === module) server.listen(PORT, "127.0.0.1", () => console.log("prototype API on " + PORT));
