/* E-Sentry demo security helpers.
   IMPORTANT: this is a static front-end demo. Data and "accounts" live in the
   browser (localStorage). Hashing here prevents plain-text passwords in storage
   and in the source, but it is NOT server-side security. A real deployment needs
   a backend with real authentication, authorization and a database. */
(function (w) {
  const enc = new TextEncoder();
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function hex(buf) { return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join(""); }
  function randSalt() { const a = new Uint8Array(16); crypto.getRandomValues(a); return hex(a); }
  // PBKDF2-SHA256, 120k iterations, per-password random salt. Format: pbkdf2$salt$hash
  async function hashPassword(pw, salt) {
    salt = salt || randSalt();
    const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 120000 }, key, 256);
    return "pbkdf2$" + salt + "$" + hex(bits);
  }
  async function verifyPassword(pw, stored) {
    if (typeof stored !== "string" || stored.indexOf("pbkdf2$") !== 0) return false;
    const salt = stored.split("$")[1];
    const h = await hashPassword(pw, salt);
    if (h.length !== stored.length) return false;
    let d = 0; for (let i = 0; i < h.length; i++) d |= h.charCodeAt(i) ^ stored.charCodeAt(i);
    return d === 0;
  }
  // Simple login throttling (client-side, demo only)
  function throttle(key) {
    const k = "esentry_fail_" + key, now = Date.now();
    let s = {}; try { s = JSON.parse(localStorage.getItem(k) || "{}"); } catch (e) {}
    if (s.until && now < s.until) return Math.ceil((s.until - now) / 1000);
    return 0;
  }
  function recordFail(key) {
    const k = "esentry_fail_" + key; let s = {}; try { s = JSON.parse(localStorage.getItem(k) || "{}"); } catch (e) {}
    s.n = (s.n || 0) + 1; if (s.n >= 5) { s.until = Date.now() + 30000; s.n = 0; }
    localStorage.setItem(k, JSON.stringify(s));
  }
  function clearFail(key) { localStorage.removeItem("esentry_fail_" + key); }
  w.ESSec = { esc, hashPassword, verifyPassword, throttle, recordFail, clearFail };
})(window);
/* Admin password: no default password ships in the source. The first admin sign-in
   in a browser sets the password (min 10 chars), stored as a salted PBKDF2 hash. */
(function (w) {
  const KEY = "esentry_admin_hash";
  w.ESSec.adminCheck = async function (pass) {
    const wait = w.ESSec.throttle("admin");
    if (wait) return { ok: false, msg: "محاولات كثيرة. حاول بعد " + wait + " ثانية" };
    let stored = localStorage.getItem(KEY);
    if (!stored) {
      if (!pass || pass.length < 10) return { ok: false, msg: "أول دخول: اختر كلمة مرور للمشرف من 10 رموز على الأقل" };
      localStorage.setItem(KEY, await w.ESSec.hashPassword(pass));
      return { ok: true, msg: "تم تعيين كلمة مرور المشرف لهذا المتصفح", first: true };
    }
    if (await w.ESSec.verifyPassword(pass, stored)) { w.ESSec.clearFail("admin"); return { ok: true }; }
    w.ESSec.recordFail("admin");
    return { ok: false, msg: "كلمة المرور الإدارية غير صحيحة" };
  };
})(window);
