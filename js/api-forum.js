/* Server mode only: forum posts, replies, moderation and delete are stored and checked by the server
   (server/server.js). On a static host /api does not exist and this file does nothing.
   Likes are not implemented on the server in this version. */
(async function () {
  if (!document.getElementById("forum-root")) return;
  let cache;
  const api = (m, p, b) => fetch(p, { method: m, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) }));
  try {
    const r = await fetch("/api/posts", { credentials: "same-origin" });
    if (!r.ok || !(r.headers.get("content-type") || "").includes("application/json")) return;
    cache = (await r.json()).posts;
  } catch (e) { return; }
  if (!Array.isArray(cache)) return;
  const stats = ES_Storage.getStats() || {};
  const ago = (t) => (t ? new Date(t).toLocaleDateString("ar-EG") : "الآن");
  const map = (p) => ({ id: String(p.id), title: p.title, content: p.content, category: p.category, status: p.status, author: p.author, authorEmail: p.mine ? stats.email || "" : "", createdAt: ago(p.created), likes: 0, likedByMe: false, answers: (p.answers || []).map((a) => ({ id: String(a.id), author: a.author, content: a.content, createdAt: ago(a.created) })) });
  const reload = async () => { const r = await api("GET", "/api/posts"); if (r.ok) cache = r.j.posts; renderForumRoot(); };
  window.ES_SERVER_FORUM = true;
  ES_Storage.getForumPosts = () => cache.map(map);
  const fail = (r) => showToast(r.status === 429 ? "محاولات كثيرة. حاول بعد دقيقة" : "تعذر تنفيذ الطلب", "warning");
  window.handleNewQuestionSubmit = async function (e) {
    e.preventDefault();
    const title = document.getElementById("new-q-title").value.trim(), content = document.getElementById("new-q-content").value.trim();
    if (!title || !content) return showToast("يرجى إدخال جميع الحقول المطلوبة", "warning");
    const r = await api("POST", "/api/posts", { title, content, category: document.getElementById("new-q-category").value });
    if (!r.ok) return fail(r);
    toggleNewQuestionForm(); document.getElementById("new-q-title").value = ""; document.getElementById("new-q-content").value = "";
    showToast("تم إرسال سؤالك وهو بانتظار موافقة المشرف", "success"); reload();
  };
  window.handleNewAnswerSubmit = async function (e, id) {
    e.preventDefault();
    const input = document.getElementById("answer-input-" + id); if (!input || !input.value.trim()) return;
    const r = await api("POST", "/api/posts/" + encodeURIComponent(id) + "/answers", { content: input.value.trim() });
    if (!r.ok) return fail(r);
    await reload(); document.getElementById("replies-section-" + id)?.classList.remove("hidden");
  };
  window.handleDeletePost = async function (id) {
    if (!confirm("هل أنت متأكد من حذف هذا المنشور؟")) return;
    const r = await api("DELETE", "/api/posts/" + encodeURIComponent(id)); if (!r.ok) return fail(r); showToast("تم حذف المنشور", "success"); reload();
  };
  window.deletePost = window.handleDeletePost;
  window.approvePost = async function (id) { const r = await api("POST", "/api/posts/" + encodeURIComponent(id) + "/approve"); if (!r.ok) return fail(r); showToast("تم اعتماد المنشور", "success"); reload(); };
  window.handleLikePost = function () { showToast("الإعجابات غير متاحة في وضع الخادم حالياً", "warning"); };
  renderForumRoot();
})();
