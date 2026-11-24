const { server } = require("./server.js");
const assert = require("assert");
let base, results = [];
async function call(method, path, body, cookie) {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie"); let j = {}; try { j = await r.json(); } catch (e) {}
  return { s: r.status, j, cookie: sc ? sc.split(";")[0] : null, text: JSON.stringify(j) };
}
async function t(name, fn) { try { await fn(); results.push(true); console.log("PASS", name); } catch (e) { results.push(false); console.log("FAIL", name, e.message); } }
server.listen(0, "127.0.0.1", async () => {
  base = "http://127.0.0.1:" + server.address().port;
  const pw = "Student-Pass-123";
  await call("POST", "/api/register", { name: "Exam One", email: "e1@t.com", password: pw });
  await call("POST", "/api/register", { name: "Exam Two", email: "e2@t.com", password: pw });
  const A = (await call("POST", "/api/login", { email: "e1@t.com", password: pw })).cookie;
  const B = (await call("POST", "/api/login", { email: "e2@t.com", password: pw })).cookie;
  let exam;
  await t("exams require login", async () => assert.equal((await call("GET", "/api/exams")).s, 401));
  await t("exam list has questions but no answer key or explanations", async () => {
    const r = await call("GET", "/api/exams", null, A); exam = r.j.exams[0];
    assert(r.j.exams.length >= 1 && exam.questions.length === 30);
    assert(!/correctAnswer|explanation/.test(r.text));
  });
  await t("one attempt per exam; a blank submit does not reveal the key", async () => {
    const first = await call("POST", "/api/exams/" + exam.id + "/submit", { answers: {} }, A);
    assert.equal(first.s, 200); assert.equal(first.j.score, 0);
    assert(!/correctAnswer|explanation/.test(first.text));
    assert.equal((await call("POST", "/api/exams/" + exam.id + "/submit", { answers: {} }, A)).s, 409);
  });
  await t("correct answers score 100 for a fresh student (key taken from public demo data, as an attacker could in static mode)", async () => {
    const vm = require("vm"), c = { window: {}, localStorage: { getItem() { return null; }, setItem() {} } }; vm.createContext(c);
    vm.runInContext(require("fs").readFileSync(__dirname + "/../js/data.js", "utf8") + ";globalThis.__E=INITIAL_EXAMS", c);
    const key = Object.fromEntries(c.__E[0].questions.map((q) => [q.id, q.correctAnswer]));
    const C = (await call("POST", "/api/register", { name: "Exam Three", email: "e3@t.com", password: pw }), (await call("POST", "/api/login", { email: "e3@t.com", password: pw })).cookie);
    const r = await call("POST", "/api/exams/" + exam.id + "/submit", { answers: key }, C);
    assert.equal(r.j.percentage, 100); assert.equal(r.j.passed, true);
  });
  await t("client-supplied score field is ignored", async () => {
    const r = await call("POST", "/api/exams/" + exam.id + "/submit", { answers: {}, score: 30, percentage: 100 }, B);
    assert.equal(r.j.percentage, 0);
  });
  await t("out-of-range or non-integer answers rejected", async () => {
    assert.equal((await call("POST", "/api/exams/" + exam.id + "/submit", { answers: { 1: 9 } }, B)).s, 400);
    assert.equal((await call("POST", "/api/exams/" + exam.id + "/submit", { answers: { 1: "0" } }, B)).s, 400);
    assert.equal((await call("POST", "/api/exams/" + exam.id + "/submit", { answers: [1] }, B)).s, 400);
  });
  await t("unknown exam is 404", async () => assert.equal((await call("POST", "/api/exams/nope/submit", { answers: {} }, A)).s, 404));
  await t("students only see their own results", async () => {
    const a = (await call("GET", "/api/results", null, A)).j.results, b = (await call("GET", "/api/results", null, B)).j.results;
    assert.equal(a.length, 1); assert.equal(b.length, 1); assert.equal(b[0].percentage, 0);
  });
  await t("student cannot read admin results", async () => assert.equal((await call("GET", "/api/admin/results", null, A)).s, 403));
  console.log(JSON.stringify({ passed: results.filter(Boolean).length, total: results.length }));
  server.close(); process.exit(results.every(Boolean) ? 0 : 1);
});
