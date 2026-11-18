// ─────────────────────────────────────────────────────────────────────────────
// schedule.preview.jsx – LOCAL TESTING ONLY. Lets you open the Schedule page
// without the backend or a real login.
//
// Enable it by starting the dev server with:
//     REACT_APP_SCHEDULE_MOCK=true npm start
//   (Windows PowerShell:  $env:REACT_APP_SCHEDULE_MOCK="true"; npm start)
//
// What it does when enabled:
//   1. schedule.logic.jsx uses its in-memory mock API instead of /schedules.
//   2. A fake superadmin session (fake token + user) is written to
//      localStorage so the existing login/route guards let you in. No core
//      file (App.js, Sidebar.jsx, utils/auth.jsx) is modified for this.
//
// Safety:
//   - Requires NODE_ENV === "development", so it is inert in production
//     builds (`npm run build`) and in Jest tests (NODE_ENV === "test"), even
//     if the env var is accidentally set.
//   - While the flag is on, it ALWAYS replaces whatever session is in
//     localStorage with the fake superadmin (a stale/expired real token used
//     to block this and dump you on /login). Real sessions are not touched
//     when the flag is off.
//   - The fake token is NOT accepted by any real backend; it only satisfies
//     the frontend's expiry check. Real API calls with it would get 401.
//   - Logging out clears it; it is re-seeded on the next page reload.
// ─────────────────────────────────────────────────────────────────────────────

export const isSchedulePreview =
  process.env.NODE_ENV === "development" && process.env.REACT_APP_SCHEDULE_MOCK === "true";

const b64url = (obj) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const seedSchedulePreviewSession = () => {
  if (!isSchedulePreview) return;
  try {
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 7 days
    localStorage.setItem("token", `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ exp })}.preview`);
    localStorage.setItem(
      "user",
      JSON.stringify({
        _id: "local-superadmin",
        firstName: "Local",
        surname: "Superadmin",
        role: "superadmin",
        permissions: [],
      })
    );
    // eslint-disable-next-line no-console
    console.info("[schedule preview] signed in as fake superadmin (dev only)");
  } catch {
    /* storage unavailable — nothing to seed */
  }
};

// Runs once when this module is first imported. schedule.logic.jsx is imported
// by App.js at startup, i.e. BEFORE App reads the session from localStorage.
seedSchedulePreviewSession();