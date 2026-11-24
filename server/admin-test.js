// run with ADMIN_EMAIL / ADMIN_PASSWORD env set
const { server } = require("./server.js"); const assert = require("assert");
server.listen(0, "127.0.0.1", async () => {
  const base = "http://127.0.0.1:" + server.address().port;
  const c = async (m, p, b, ck) => { const r = await fetch(base + p, { method: m, headers: { "Content-Type": "application/json", ...(ck ? { Cookie: ck } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})), ck: (r.headers.get("set-cookie") || "").split(";")[0] }; };
  const ok = [];
  const t = async (n, f) => { try { await f(); ok.push(1); console.log("PASS", n); } catch (e) { console.log("FAIL", n, e.message); } };
  await c("POST", "/api/register", { name: "Stu Dent", email: "s@t.com", password: "Student-Pass-123" });
  const s = (await c("POST", "/api/login", { email: "s@t.com", password: "Student-Pass-123" })).ck;
  await c("POST", "/api/posts", { title: "Question", content: "Body text" }, s);
  const a = await c("POST", "/api/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  await t("admin from env can log in with role admin", async () => assert.equal(a.j.role, "admin"));
  await t("no default admin: guessed passwords fail", async () => assert.equal((await c("POST", "/api/login", { email: process.env.ADMIN_EMAIL, password: "admin123" })).s, 401));
  await t("admin sees pending posts", async () => assert.equal((await c("GET", "/api/posts", null, a.ck)).j.posts.length, 1));
  await t("admin approves, student sees approved", async () => { assert.equal((await c("POST", "/api/posts/1/approve", {}, a.ck)).s, 200); assert.equal((await c("GET", "/api/posts", null, s)).j.posts[0].status, "approved"); });
  await t("admin lists users without password hashes", async () => { const u = (await c("GET", "/api/admin/users", null, a.ck)).j.users; assert(u.length === 2 && !JSON.stringify(u).includes("scrypt")); });
  console.log(JSON.stringify({ passed: ok.length, total: 5 })); server.close(); process.exit(0);
});
