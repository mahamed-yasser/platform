/* Server mode: when the site is served by server/server.js, sign-in, registration and
   the admin role are checked by the SERVER (session cookie), not by localStorage.
   On a plain static host (GitHub Pages etc.) /api does not exist and this file does nothing,
   so the original browser-only demo keeps working. Course/forum content is still stored in
   localStorage in this version (see server/README.md). */
(async function () {
  let mode = false, me = null;
  try {
    const r = await fetch("/api/me", { credentials: "same-origin" });
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("application/json")) { mode = true; if (r.ok) me = await r.json(); }
  } catch (e) {}
  if (!mode) return;
  window.ES_SERVER_MODE = true;
  const post = (p, b) => fetch(p, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) }).then(async (r) => ({ ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) }));
  const path = location.pathname.toLowerCase();
  const free = path.endsWith("login.html") || path.endsWith("register.html");
  const setLocal = (name, email, role) => {
    localStorage.setItem("esentry_role", role); localStorage.setItem("esentry_user_role", role);
    localStorage.setItem("isLoggedIn", "true"); localStorage.setItem("active_user", email);
    const stats = { name, email, role, isLoggedIn: true };
    const old = (() => { try { return JSON.parse(localStorage.getItem("esentry_stats_" + email) || "{}"); } catch (e) { return {}; } })();
    const merged = Object.assign({ level: "المستوى الأول - تقنية المعلومات" }, old, stats);
    localStorage.setItem("esentry_stats_" + email, JSON.stringify(merged)); localStorage.setItem("esentry_stats", JSON.stringify(merged));
  };
  const clearLocal = () => ["active_user", "esentry_active_user", "esentry_role", "esentry_user_role"].forEach((k) => localStorage.removeItem(k)) || localStorage.setItem("isLoggedIn", "false");
  const err = {
    invalid_input: "تحقق من البيانات (الاسم، البريد، كلمة مرور 10 رموز على الأقل)", email_taken: "هذا البريد مسجل بالفعل",
    bad_credentials: "البريد أو كلمة المرور غير صحيحة", rate_limited: "محاولات كثيرة. حاول بعد دقيقة",
  };
  const toast = (m, t) => (typeof showToast === "function" ? showToast(m, t) : alert(m));

  // Route guard: the server session decides, localStorage flags are only a cache
  if (!free) {
    if (!me) { clearLocal(); location.replace("login.html"); return; }
    if (path.endsWith("admin.html") && me.role !== "admin") { location.replace("index.html"); return; }
    setLocal(me.name, me.email, me.role);
  }
  if (free && me) { setLocal(me.name, me.email, me.role); location.replace(me.role === "admin" ? "admin.html" : "index.html"); return; }

  window.handleLoginSubmit = async function (e) {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim(), password = document.getElementById("login-password").value;
    const r = await post("/api/login", { email, password });
    if (!r.ok) return toast(err[r.j.error] || "تعذر تسجيل الدخول", "warning");
    const m = await (await fetch("/api/me", { credentials: "same-origin" })).json();
    setLocal(m.name, m.email, m.role); toast("مرحباً " + m.name, "success");
    setTimeout(() => (location.href = m.role === "admin" ? "admin.html" : "index.html"), 600);
  };
  window.handleRegisterSubmit = async function (e) {
    e.preventDefault();
    const name = document.getElementById("reg-name").value.trim(), email = document.getElementById("reg-email").value.trim(), password = document.getElementById("reg-password").value;
    const r = await post("/api/register", { name, email, password });
    if (!r.ok) return toast(err[r.j.error] || "تعذر إنشاء الحساب", "warning");
    const l = await post("/api/login", { email, password });
    if (!l.ok) return toast("تم إنشاء الحساب، سجّل الدخول الآن", "success");
    setLocal(name, email, "student"); toast("تم إنشاء حسابك", "success");
    setTimeout(() => (location.href = "index.html"), 600);
  };
  // Admin tab on the login page: server-side admin account (email + password)
  const origAdminForm = window.getAdminLoginFormHtml;
  if (origAdminForm) window.getAdminLoginFormHtml = function () {
    const h = origAdminForm();
    const field = '<div><label class="block text-xs font-bold text-slate-300 mb-2">بريد المشرف</label><input type="email" id="admin-login-email" required class="w-full bg-slate-900/80 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-100 outline-none"></div>';
    return h.replace(/(<form id="form-admin-login"[^>]*>)/, "$1" + field);
  };
  window.handleAdminLoginSubmit = async function (e) {
    e.preventDefault();
    const email = (document.getElementById("admin-login-email") || {}).value || "", password = document.getElementById("admin-login-pass").value;
    const r = await post("/api/login", { email, password });
    if (!r.ok) return toast(err[r.j.error] || "بيانات المشرف غير صحيحة", "warning");
    const m = await (await fetch("/api/me", { credentials: "same-origin" })).json();
    if (m.role !== "admin") { await post("/api/logout"); clearLocal(); return toast("هذا الحساب ليس حساب مشرف", "warning"); }
    setLocal(m.name, m.email, "admin"); setTimeout(() => (location.href = "admin.html"), 500);
  };
  const origLogout = window.handleLogout;
  window.handleLogout = async function () { await post("/api/logout"); clearLocal(); if (origLogout) { try { origLogout(); } catch (e) {} } location.replace("login.html"); };
})();
