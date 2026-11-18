// ─────────────────────────────────────────────────────────────────────────────
// supply.owed.jsx – the "owed to clients" ledger, shared by the Supply page
// and the Store page so both always agree.
//
//   fetchOwedList()  → GET  /supply/owed            (what we owe, aggregated)
//   repayOwed(...)   → POST /supply/owed/repay      (stock was replaced)
//   owedByPart(list) → Map keyed by normalised part number (for the Store page)
//
// In preview mode (REACT_APP_SUPPLY_MOCK=true) everything runs against an
// in-memory ledger instead of the backend. The REAL backend contract for these
// endpoints and the ledger collection is written up in the BACKEND GUIDE at the
// top of supply.logic.jsx (and the Store side in store.logic.jsx).
// ─────────────────────────────────────────────────────────────────────────────

import { mockDataClients } from "../../data/mockData";
import { hasPermission, isAdminOrSuper } from "../../utils/auth";
import { isSupplyPreview } from "./supply.preview";
import { isStorePreview } from "../store/store.preview";

export const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:5000";
// Either preview flag mocks the shared ledger, so Supply and Store always agree.
export const USE_MOCK = isSupplyPreview || isStorePreview;

// Moving stock from one client's holding to another client creates an "owed"
// record for the client it was taken from. true = only administrators and
// superadmins may take stock from another client or record a repayment
// (recommended — it creates / clears a debt). false = anyone with the "supply"
// permission. The backend MUST enforce the same rule.
export const TRANSFER_REQUIRES_ADMIN = true;
export const canRecordTransfers = () =>
  TRANSFER_REQUIRES_ADMIN ? isAdminOrSuper() : hasPermission("supply");

// "pr-1001 " and "PR-1001" are the same part. The backend must normalise the
// same way (trim + uppercase) when saving ledger rows and comparing parts.
export const partKey = (p) => String(p ?? "").trim().toUpperCase();

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

// ── mock ledger (preview only) ───────────────────────────────────────────────
// Mirrors the backend "supplyLedger" collection. APPEND-ONLY: corrections are
// new rows, never edits.
export const mockMe = { _id: "local-superadmin", firstName: "Local", surname: "Superadmin" };
export const mockDelay = (ms = 250) => new Promise((r) => setTimeout(r, ms));

export const mockClientRef = (id) => {
  const c = mockDataClients.find((x) => String(x.id) === String(id)) || mockDataClients[0];
  return { id: c?.id, _id: c?.id, companyName: c?.companyName };
};

let mockLedger = [];

export const mockAddLedger = (entry) => {
  mockLedger = [
    ...mockLedger,
    { _id: `l${Date.now()}_${mockLedger.length}`, createdAt: new Date().toISOString(), createdBy: mockMe, ...entry },
  ];
};

// Same aggregation as GET /supply/owed on the real backend
export const mockOwedList = () => {
  const groups = new Map();
  mockLedger.forEach((e) => {
    const k = `${e.clientId}|${partKey(e.partNumber)}`;
    const g = groups.get(k) || { clientId: e.clientId, partNumber: partKey(e.partNumber), goodsSupplied: e.goodsSupplied, total: 0, lastTakenAt: null };
    g.total += e.qtyChange;
    g.goodsSupplied = e.goodsSupplied || g.goodsSupplied;
    if (e.type === "borrowed_out" && (!g.lastTakenAt || e.createdAt > g.lastTakenAt)) g.lastTakenAt = e.createdAt;
    groups.set(k, g);
  });
  return [...groups.values()]
    .filter((g) => g.total < 0)
    .map((g) => ({
      client: mockClientRef(g.clientId),
      partNumber: g.partNumber,
      goodsSupplied: g.goodsSupplied,
      owed: -g.total,
      lastTakenAt: g.lastTakenAt,
    }));
};

// Reverse the ledger effect of deleted supply entries (guide step 6)
export const mockReverseTransfers = (supplyIds) => {
  mockLedger
    .filter((e) => supplyIds.includes(e.relatedSupply) && e.type === "borrowed_out")
    .forEach((e) =>
      mockAddLedger({
        clientId: e.clientId, partNumber: e.partNumber, goodsSupplied: e.goodsSupplied,
        qtyChange: -e.qtyChange, type: "reversed", relatedSupply: e.relatedSupply, note: "Supply entry deleted",
      })
    );
};

// ── API ──────────────────────────────────────────────────────────────────────

// → [{ client, partNumber, goodsSupplied, owed, lastTakenAt }]. Throws on error.
export const fetchOwedList = async () => {
  if (USE_MOCK) return mockOwedList();
  const res = await fetch(`${API_BASE}/supply/owed`, { headers: authBearer() });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || "Failed to load owed stock.");
  return Array.isArray(data) ? data : [];
};

// Record that `quantity` units were replaced for a client. Throws on error.
export const repayOwed = async ({ clientId, partNumber, goodsSupplied, quantity, note }) => {
  if (USE_MOCK) {
    await mockDelay();
    mockAddLedger({ clientId, partNumber, goodsSupplied, qtyChange: quantity, type: "settled", note });
    return;
  }
  const res = await fetch(`${API_BASE}/supply/owed/repay`, {
    method: "POST",
    headers: authJson(),
    body: JSON.stringify({ clientId, partNumber, quantity, note }),
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || "Failed to record repayment.");
};

// Group the owed list by part so the Store page can look a part up quickly.
// → Map( "PR-1001" → { total: 6, entries: [{ clientId, companyName, partNumber, goodsSupplied, owed }] } )
export const owedByPart = (list) => {
  const map = new Map();
  (list || []).forEach((o) => {
    const k = partKey(o.partNumber);
    const g = map.get(k) || { total: 0, entries: [] };
    g.total += Number(o.owed) || 0;
    g.entries.push({
      clientId: o.client?.id ?? o.client?._id,
      companyName: o.client?.companyName,
      partNumber: o.partNumber,
      goodsSupplied: o.goodsSupplied,
      owed: Number(o.owed) || 0,
    });
    map.set(k, g);
  });
  return map;
};