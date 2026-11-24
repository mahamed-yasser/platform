/* Server mode only: exams are served WITHOUT the answer key and scored by the server (server/server.js).
   On a static host /api does not exist and this file does nothing (browser-only demo behaviour stays).
   Limit: the demo data file js/data.js (and localStorage seeded from it) still contains the key in this prototype. */
(async function () {
  if (!document.getElementById("exams-root")) return;
  let exams;
  try {
    const r = await fetch("/api/exams", { credentials: "same-origin" });
    if (!r.ok || !(r.headers.get("content-type") || "").includes("application/json")) return;
    exams = (await r.json()).exams;
  } catch (e) { return; }
  if (!Array.isArray(exams)) return;
  let done = {};
  try { (await (await fetch("/api/results", { credentials: "same-origin" })).json()).results.forEach((x) => { if (!done[x.exam_id]) done[x.exam_id] = x; }); } catch (e) {}
  const esc = (s) => (window.ESSec ? ESSec.esc(String(s)) : String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
  window.ES_SERVER_EXAMS = true;
  ES_Storage.getExams = () => exams;
  ES_Storage.getResults = () => Object.fromEntries(Object.entries(done).map(([k, v]) => [k, { completed: true, percentage: v.percentage, score: v.score, total: v.total }]));

  window.submitExam = async function () {
    if (!currentExam || isSubmitted) return;
    isSubmitted = true;
    if (timerInterval) clearInterval(timerInterval);
    if (antiCheatCleanup) antiCheatCleanup();
    const r = await fetch("/api/exams/" + encodeURIComponent(currentExam.id) + "/submit", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: userAnswers }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 409) { showToast("تم تسليم هذا الاختبار من قبل ولا يمكن إعادته", "warning"); return backToExamsList(); }
    if (!r.ok) { isSubmitted = false; return showToast("تعذر تسليم الاختبار، حاول مرة أخرى", "warning"); }
    done[currentExam.id] = { percentage: j.percentage, score: j.score, total: j.total };
    renderServerResults(j);
    showToast(`تم تصحيح الاختبار على الخادم. نتيجتك: ${j.percentage}%`, j.passed ? "success" : "warning");
  };

  function renderServerResults(j) {
    document.getElementById("active-exam-view")?.classList.add("hidden");
    document.getElementById("exam-results-view")?.classList.remove("hidden");
    const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
    set("result-score-percent", j.percentage + "%"); set("result-score-fraction", `${j.score} من ${j.total}`);
    set("result-status-title", j.passed ? "تهانينا! اجتزت الاختبار 🎉" : "تحتاج إلى مزيد من المراجعة 💪");
    set("result-status-desc", j.passed ? "تم تسجيل نتيجتك على الخادم." : "المراجعة أدناه تعرض الأسئلة التي أجبتها صح فقط. لا تُعرض الإجابات الصحيحة للأسئلة الخاطئة.");
    const box = document.getElementById("exam-questions-review"); if (!box) return;
    box.innerHTML = currentExam.questions.map((q, i) => {
      const rv = j.review.find((x) => x.id === q.id) || {};
      return `<div class="p-5 rounded-2xl bg-slate-900/80 border ${rv.correct ? "border-emerald-500/30" : "border-rose-500/30"} mb-4">
        <span class="text-xs font-bold ${rv.correct ? "text-emerald-400" : "text-rose-400"}">السؤال ${i + 1} ${rv.correct ? "(إجابة صحيحة)" : rv.yours === null || rv.yours === undefined ? "(لم تتم الإجابة)" : "(إجابة خاطئة)"}</span>
        <h4 class="text-sm font-bold text-slate-100 my-3 leading-relaxed">${esc(q.question)}</h4>
        ${rv.correct ? `<div class="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 text-xs text-slate-300">${esc(rv.explanation)}</div>` : ""}</div>`;
    }).join("");
  }
  // re-render with the server's exam list (the page's own start-up already ran with local data)
  const id = new URLSearchParams(location.search).get("id");
  if (id && exams.some((e) => e.id === id) && !done[id]) startExam(id); else renderExamsList();
})();
