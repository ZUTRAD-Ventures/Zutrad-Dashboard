// ─────────────────────────────────────────────────────────────────────────────
// supply.preview.jsx – LOCAL TESTING ONLY. Lets you open the Supply page
// (including the Excel import) without the backend or a real login.
//
// Enable it by starting the dev server with:
//     REACT_APP_SUPPLY_MOCK=true npm start
//   (Windows PowerShell:  $env:REACT_APP_SUPPLY_MOCK="true"; npm start)
//
// What it does when enabled:
//   1. supply.logic.jsx uses an in-memory mock API instead of /supply.
//      Everything (log, import, delete) works but resets on page refresh.
//   2. A fake superadmin session (fake token + user) is written to
//      localStorage so the existing login/route guards let you in. No core
//      file (App.js, Sidebar.jsx, utils/auth.jsx) is modified for this.
//
// Safety:
//   - Requires NODE_ENV === "development", so it is inert in production
//     builds (`npm run build`) and in Jest tests, even if the env var is set.
//   - While the flag is on, it ALWAYS replaces whatever session is in
//     localStorage with the fake superadmin. Real sessions are not touched
//     when the flag is off.
//   - The fake token is NOT accepted by any real backend; it only satisfies
//     the frontend's expiry check.
//   - Logging out clears it; it is re-seeded on the next page reload.
// ─────────────────────────────────────────────────────────────────────────────

export const isSupplyPreview =
  process.env.NODE_ENV === "development" && process.env.REACT_APP_SUPPLY_MOCK === "true";

const b64url = (obj) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const seedSupplyPreviewSession = () => {
  if (!isSupplyPreview) return;
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
    console.info("[supply preview] signed in as fake superadmin (dev only)");
  } catch {
    /* storage unavailable — nothing to seed */
  }
};

// Runs once when this module is first imported. supply.jsx is imported by
// App.js at startup, i.e. BEFORE App reads the session from localStorage.
seedSupplyPreviewSession();
