const { server } = require("./server.js");
const assert = require("assert");
let base, results = [];
async function call(method, path, body, cookie, headers = {}) {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie"); let j = {}; try { j = await r.json(); } catch (e) {}
  return { s: r.status, j, cookie: sc ? sc.split(";")[0] : null, sc, h: r.headers };
}
async function t(name, fn) { try { await fn(); results.push([name, true]); console.log("PASS", name); } catch (e) { results.push([name, false]); console.log("FAIL", name, e.message); } }
server.listen(0, "127.0.0.1", async () => {
  base = "http://127.0.0.1:" + server.address().port;
  const pw = "Student-Pass-123", pw2 = "Other-Pass-45678";
  let A, B, ADMIN;
  await t("unauthenticated cannot read posts", async () => assert.equal((await call("GET", "/api/posts")).s, 401));
  await t("short password rejected on register", async () => assert.equal((await call("POST", "/api/register", { name: "Ali Test", email: "a@t.com", password: "short" })).s, 400));
  await t("register ok", async () => assert.equal((await call("POST", "/api/register", { name: "Ali Test", email: "a@t.com", password: pw })).s, 201));
  await t("duplicate email rejected", async () => assert.equal((await call("POST", "/api/register", { name: "Ali Test", email: "a@t.com", password: pw })).s, 409));
  await t("register ignores role escalation field", async () => {
    await call("POST", "/api/register", { name: "Bob Test", email: "b@t.com", password: pw2, role: "admin" });
    const l = await call("POST", "/api/login", { email: "b@t.com", password: pw2 }); B = l.cookie; assert.equal(l.j.role, "student");
  });
  await t("wrong password rejected", async () => assert.equal((await call("POST", "/api/login", { email: "a@t.com", password: "nope-nope-nope" })).s, 401));
  await t("login sets HttpOnly SameSite=Strict cookie", async () => {
    const l = await call("POST", "/api/login", { email: "a@t.com", password: pw }); A = l.cookie;
    assert.equal(l.s, 200); assert(/HttpOnly/.test(l.sc) && /SameSite=Strict/.test(l.sc));
  });
  await t("SQL-injection style login does not authenticate", async () => assert.equal((await call("POST", "/api/login", { email: "' OR 1=1 --", password: "x" })).s, 401));
  await t("login rate limit after 5 attempts", async () => {
    let last; for (let i = 0; i < 6; i++) last = await call("POST", "/api/login", { email: "a@t.com", password: "bad-bad-bad-bad" });
    assert.equal(last.s, 429);
  });
  await t("student posts as pending", async () => assert.equal((await call("POST", "/api/posts", { title: "Hello", content: "<img src=x onerror=alert(1)>" }, A)).j.status, "pending"));
  await t("other student cannot see pending post", async () => assert.equal((await call("GET", "/api/posts", null, B)).j.posts.length, 0));
  await t("student cannot approve", async () => assert.equal((await call("POST", "/api/posts/1/approve", {}, A)).s, 403));
  await t("student cannot list users (admin route)", async () => assert.equal((await call("GET", "/api/admin/users", null, A)).s, 403));
  await t("other student cannot delete someone else's post", async () => assert.equal((await call("DELETE", "/api/posts/1", null, B)).s, 403));
  await t("cross-origin state change blocked", async () => assert.equal((await call("POST", "/api/posts", { title: "xxx", content: "yyy" }, A, { Origin: "http://evil.example" })).s, 403));
  await t("non-JSON content type rejected (CSRF form posts)", async () => { const r = await fetch(base + "/api/posts", { method: "POST", headers: { "Content-Type": "text/plain", Cookie: A }, body: "x" }); assert.equal(r.status, 415); });
  await t("security headers present", async () => { const r = await call("GET", "/api/me"); assert.equal(r.h.get("x-content-type-options"), "nosniff"); assert(r.h.get("content-security-policy")); });
  await t("logout invalidates the session", async () => { await call("POST", "/api/logout", {}, A); assert.equal((await call("GET", "/api/me", null, A)).s, 401); });
  console.log(JSON.stringify({ passed: results.filter((r) => r[1]).length, total: results.length }));
  server.close(); process.exit(results.every((r) => r[1]) ? 0 : 1);
});
