# E-Sentry backend prototype

A small zero-dependency Node 22 server (`node:sqlite`) that shows how the platform's accounts, sessions and permissions work **on a server** instead of in the browser.

Run: `ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='at-least-12-chars' node --no-warnings server.js`
Tests: `node --no-warnings test.js` (18 checks) and the admin checks with `ADMIN_EMAIL`/`ADMIN_PASSWORD` set: `node --no-warnings admin-test.js` (5 checks).

Implemented and tested: scrypt password hashing, HttpOnly + SameSite=Strict session cookies (token stored hashed), server-side roles (students cannot approve posts, read admin routes or delete others' posts), no default admin (created only from environment variables), input validation, parameterised SQL, rate limiting on login/register/posting, same-origin and JSON-only checks against CSRF, security headers, logout invalidates the session.

NOT done (this is a prototype, not production): the website front-end is not wired to this API yet; HTTPS/`Secure` cookies (needs TLS in front); persistent production database, backups, email verification, password reset, 2FA, audit logging; rate limiting is in memory; no external security review or penetration test.

## Server mode (front-end wired to the API)

`node --no-warnings server.js` also serves the website. When the site is opened through this server, `js/api-auth.js` makes registration, login, logout, the admin sign-in and the admin-page guard use the server session. On a plain static host the file does nothing and the browser-only demo works as before.
Browser end-to-end check (17 checks, headless Chrome): weak password rejected by the server; register logs in; session cookie not readable by JS; no password in localStorage; logged-out visitors are redirected; a student cannot open admin.html; forging `esentry_role=admin` in localStorage does not grant admin; logout invalidates the session; admin email field shown; wrong admin password rejected; real admin reaches the dashboard; server source files and path traversal return 404.
Still browser-only in this version: courses, lessons, exam answers/results, forum posts and the admin data tables (localStorage). Exam correct answers are in the public JavaScript, so exams can be cheated by anyone who reads it.

## Exams API (prototype, tested by `node server/exam-test.js`, 9 checks)
- `GET /api/exams` returns questions and options only, no answer key.
- `POST /api/exams/:id/submit` scores on the server. Client-sent scores are ignored. One attempt per user per exam.
  The review reveals the explanation only for questions answered correctly, so a submission cannot be used to read the key.
- `GET /api/results` returns the signed-in student's own results. `GET /api/admin/results` is admin only.
- Limits: the server reads the key from `js/data.js` on disk at startup (never sent in server mode); on a static host the file is public, so the key is
  still visible to anyone who opens that file. Moving it to a server-only file is required before real use.
  (The exam page is wired to these endpoints when served by this server; see "Exam page wiring".)

### Exam page wiring (server mode only)
`js/api-exams.js` (loaded on exams.html) switches the exam page to the API when `/api/exams` answers: questions are loaded without the key,
submission is scored by the server, the review shows explanations only for correct answers, and a second attempt is blocked.
Browser e2e: `python3 server/e2e-exams.py` against a running server (8 checks, passed). On a static host it does nothing and the original local scoring remains.
Server mode serves js/data.js with the answer key and explanations removed (verified). On a static host the public js/data.js still holds the key, so the key is not secret there.

## Forum (server mode)
`js/api-forum.js` (loaded on forum.html) switches the forum to the server when `/api` exists: questions (with category), replies, admin approval and delete (owner or admin) are stored and checked by the server. New questions stay pending until an admin approves. Likes are not implemented on the server (button shows a notice). Tests: `server/e2e-forum.py` (12 checks, needs the server running on port 3199). On a static host the forum stays browser-local demo data.
Still browser-local: course progress, admin tables other than users/posts/results.
