// ─────────────────────────────────────────────────────────────────────────────
// supply.owed.jsx – the "owed to clients" ledger, shared by the Supply page
// and the Store page so both always agree.
//
//   fetchOwedList()  → GET  /supply/owed            (what we owe, aggregated)
//   repayOwed(...)   → POST /supply/owed/repay      (stock was replaced)
//   owedBySerial(list) → Map keyed by normalised serial number (for the Store page)
//
// The backend contract for these endpoints and the ledger collection is written
// up in the BACKEND GUIDE at the top of supply.logic.jsx (and the Store side in
// store.logic.jsx). Backend: routes/supply.js, models/SupplyLedger.js.
// ─────────────────────────────────────────────────────────────────────────────

import { hasPermission, isAdminOrSuper } from "../../utils/auth";

export const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:5000";

// Moving stock from one client's holding to another client creates an "owed"
// record for the client it was taken from. true = only administrators and
// superadmins may take stock from another client or record a repayment
// (recommended — it creates / clears a debt). false = anyone with the "supply"
// permission. The backend MUST enforce the same rule.
export const TRANSFER_REQUIRES_ADMIN = true;
export const canRecordTransfers = () =>
  TRANSFER_REQUIRES_ADMIN ? isAdminOrSuper() : hasPermission("supply");

// "sn-1001 " and "SN-1001" are the same item. The backend normalises the same
// way (trim + uppercase) when saving ledger rows. Owed stock is tracked per
// serial number, not per part number.
export const serialKey = (s) => String(s ?? "").trim().toUpperCase();

const authBearer = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });
const authJson = () => ({ "Content-Type": "application/json", ...authBearer() });

const safeJson = async (res) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error("[owed] Non-JSON response from server:", text.slice(0, 300));
    return { message: "Server returned an unexpected response. Check the backend console." };
  }
};

// ── API ──────────────────────────────────────────────────────────────────────

// → [{ client, serialNumber, goodsSupplied, owed, lastTakenAt }]. Throws on error.
export const fetchOwedList = async () => {
  const res = await fetch(`${API_BASE}/supply/owed`, { headers: authBearer() });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || "Failed to load owed stock.");
  return Array.isArray(data) ? data : [];
};

// Record that `quantity` units were replaced for a client. Throws on error.
export const repayOwed = async ({ clientId, serialNumber, goodsSupplied, quantity, note }) => {
  const res = await fetch(`${API_BASE}/supply/owed/repay`, {
    method: "POST",
    headers: authJson(),
    body: JSON.stringify({ clientId, serialNumber, quantity, note }),
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || "Failed to record repayment.");
};

// Group the owed list by serial number so the Store page can look an item up quickly.
// → Map( "SN-1001" → { total: 6, entries: [{ clientId, companyName, serialNumber, goodsSupplied, owed }] } )
export const owedBySerial = (list) => {
  const map = new Map();
  (list || []).forEach((o) => {
    const k = serialKey(o.serialNumber);
    const g = map.get(k) || { total: 0, entries: [] };
    g.total += Number(o.owed) || 0;
    g.entries.push({
      clientId: o.client?.id ?? o.client?._id,
      companyName: o.client?.companyName,
      serialNumber: o.serialNumber,
      goodsSupplied: o.goodsSupplied,
      owed: Number(o.owed) || 0,
    });
    map.set(k, g);
  });
  return map;
};