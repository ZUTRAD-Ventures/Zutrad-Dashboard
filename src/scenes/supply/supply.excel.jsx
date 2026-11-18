// ─────────────────────────────────────────────────────────────────────────────
// supply.excel.jsx – Pure helpers for importing supply rows from an Excel/CSV
// file and for downloading a blank template. No React / JSX in here.
//
// Requires the SheetJS package:   npm install xlsx
// It is loaded lazily (dynamic import) so it only costs bundle size when the
// user actually opens the import dialog.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB
export const ACCEPTED_EXT = [".xlsx", ".xls", ".csv"];

// Accepted header spellings → canonical field. Matching ignores case,
// spaces, dots, underscores and punctuation ("Part No." == "part_no").
const HEADER_ALIASES = {
  goodsSupplied: ["goodssupplied", "goods", "item", "items", "description", "product", "goodsdescription"],
  partNumber:    ["partnumber", "partno", "partnum", "part", "pn", "partcode", "sku"],
  quantity:      ["quantity", "qty", "units", "amount", "qtysupplied"],
  client:        ["client", "clientname", "company", "companyname", "customer"],
  supplyDate:    ["supplydate", "date", "datesupplied", "supplieddate", "deliverydate"],
  // OPTIONAL columns — stock taken from ANOTHER client's holding (creates an
  // "owed" record for that client, see supply.logic.jsx backend guide).
  takenFrom:     ["takenfrom", "takenfromclient", "sourceclient", "borrowedfrom", "takenfromoptional"],
  transferNote:  ["transfernote", "note", "notes", "reason", "transferreason", "transfernoteoptional"],
};

// Columns that must exist. The others above are optional.
const REQUIRED_FIELDS = ["goodsSupplied", "partNumber", "quantity", "client", "supplyDate"];

export const FIELD_LABELS = {
  goodsSupplied: "Goods Supplied",
  partNumber: "Part Number",
  quantity: "Quantity",
  client: "Client",
  supplyDate: "Supply Date",
  takenFrom: "Taken From",
  transferNote: "Transfer Note",
};

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const pad = (n) => String(n).padStart(2, "0");
const toISO = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

const validYMD = (y, m, d) => {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

// Accepts: JS Date (SheetJS cellDates), Excel serial number, "YYYY-MM-DD",
// "DD/MM/YYYY", "DD-MM-YYYY", "DD.MM.YYYY" (day-first, as used in Nigeria).
// Returns "YYYY-MM-DD" or null.
export const normalizeDate = (value) => {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    if (isNaN(value)) return null;
    // SheetJS can land a few seconds before midnight; +12h makes the local
    // calendar day unambiguous.
    const d = new Date(value.getTime() + 12 * 60 * 60 * 1000);
    const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    return validYMD(y, m, day) ? toISO(y, m, day) : null;
  }

  if (typeof value === "number") {
    // Excel serial (days since 1899-12-30)
    if (value < 20000 || value > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    return validYMD(y, m, day) ? toISO(y, m, day) : null;
  }

  const s = String(value).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validYMD(y, mo, d) ? toISO(y, mo, d) : null;
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validYMD(y, mo, d) ? toISO(y, mo, d) : null;
  }
  return null;
};

const parseQuantity = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
};

const text = (v) => String(v ?? "").trim();

// ── parse a File into validated rows ────────────────────────────────────────
// clients:  [{ id, companyName }]
// existing: current table rows (used to flag duplicates)
// opts.allowTransfer: false → any row with a "Taken From" value is an error
//                     (only users allowed to move stock between clients).
// Returns { rows: [{ rowNum, data, errors, duplicate }], missingColumns: [] }
// Throws an Error with a user-friendly message for unreadable files.
export const parseSupplyFile = async (file, clients, existing = [], opts = {}) => {
  const { allowTransfer = true } = opts;
  const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
  if (!ACCEPTED_EXT.includes(ext)) {
    throw new Error("Unsupported file type. Please upload an .xlsx, .xls or .csv file.");
  }
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error("File is larger than 5 MB. Split it into smaller files and import them one at a time.");
  }

  let XLSX;
  try {
    XLSX = await import("xlsx");
  } catch {
    throw new Error('The "xlsx" package is not installed. Run "npm install xlsx" and restart the dev server.');
  }

  let grid;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error("empty");
    grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: false });
  } catch {
    throw new Error("Could not read this file. Make sure it is a valid, non-password-protected Excel or CSV file.");
  }

  if (!grid.length) throw new Error("The file is empty.");

  // Find the header row within the first 10 rows (tolerates title rows above).
  const aliasToField = {};
  Object.entries(HEADER_ALIASES).forEach(([field, list]) => list.forEach((a) => (aliasToField[a] = field)));

  let headerIdx = -1, colIdx = {};
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const found = {};
    grid[i].forEach((cell, c) => {
      const f = aliasToField[norm(cell)];
      if (f && found[f] === undefined) found[f] = c;
    });
    if (Object.keys(found).length >= 3 && Object.keys(found).length > Object.keys(colIdx).length) {
      headerIdx = i;
      colIdx = found;
    }
  }
  if (headerIdx === -1) {
    throw new Error(
      "Could not find the header row. The first row should contain: Goods Supplied, Part Number, Quantity, Client, Supply Date. Use the template if unsure."
    );
  }

  const missingColumns = REQUIRED_FIELDS.filter((f) => colIdx[f] === undefined);

  const dataRows = grid.slice(headerIdx + 1).filter((r) => r.some((c) => text(c) !== ""));
  if (dataRows.length === 0) throw new Error("No data rows found under the header.");
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new Error(`This file has ${dataRows.length.toLocaleString()} rows. The maximum per import is ${MAX_IMPORT_ROWS.toLocaleString()}.`);
  }

  const clientByName = new Map(clients.map((c) => [norm(c.companyName), c]));
  const keyOf = (g, p, q, c, d, t = "") => [norm(g), norm(p), q, c, d, t].join("|");
  const existingKeys = new Set(
    existing.map((r) =>
      keyOf(
        r.goodsSupplied,
        r.partNumber,
        Number(r.quantity),
        String(r.client?.id ?? r.client?._id ?? ""),
        String(r.supplyDate || "").slice(0, 10),
        String(r.takenFrom?.id ?? r.takenFrom?._id ?? "")
      )
    )
  );
  const seenInFile = new Set();

  const rows = dataRows.map((r, i) => {
    const get = (f) => (colIdx[f] === undefined ? "" : r[colIdx[f]]);
    const errors = [];

    const goodsSupplied = text(get("goodsSupplied"));
    const partNumber = text(get("partNumber"));
    const quantity = parseQuantity(get("quantity"));
    const supplyDate = normalizeDate(get("supplyDate"));
    const clientName = text(get("client"));
    const client = clientByName.get(norm(clientName));

    if (!goodsSupplied) errors.push("Goods Supplied is empty");
    if (!partNumber) errors.push("Part Number is empty");
    if (quantity === null) errors.push("Quantity must be a number above 0");
    if (!supplyDate) errors.push(text(get("supplyDate")) ? "Date not recognised (use DD/MM/YYYY)" : "Supply Date is empty");
    if (!clientName) errors.push("Client is empty");
    else if (!client) errors.push(`Client "${clientName}" not found`);

    // Optional: stock taken from another client's holding
    const takenFromName = text(get("takenFrom"));
    const takenFrom = takenFromName ? clientByName.get(norm(takenFromName)) : undefined;
    if (takenFromName) {
      if (!allowTransfer) errors.push("Only administrators can take stock from another client");
      else if (!takenFrom) errors.push(`Taken From client "${takenFromName}" not found`);
      else if (client && takenFrom.id === client.id) errors.push("Taken From can't be the same as Client");
    }
    const transferNote = takenFromName ? text(get("transferNote")) || "Imported from Excel" : "";

    let duplicate = false;
    if (!errors.length) {
      const k = keyOf(goodsSupplied, partNumber, quantity, String(client.id), supplyDate, String(takenFrom?.id ?? ""));
      duplicate = existingKeys.has(k) || seenInFile.has(k);
      seenInFile.add(k);
    }

    return {
      rowNum: headerIdx + 2 + i, // spreadsheet row number as the user sees it
      data: {
        goodsSupplied, partNumber, quantity, supplyDate,
        clientId: client?.id, clientName: client?.companyName ?? clientName,
        takenFromId: takenFrom?.id, takenFromName: takenFrom?.companyName ?? takenFromName,
        transferNote,
      },
      errors,
      duplicate,
    };
  });

  return { rows, missingColumns };
};

// ── blank template download ─────────────────────────────────────────────────
export const downloadSupplyTemplate = async (clients) => {
  const XLSX = await import("xlsx");
  const sample = clients[0]?.companyName ?? "Client Name";
  const ws = XLSX.utils.aoa_to_sheet([
    ["Goods Supplied", "Part Number", "Quantity", "Client", "Supply Date", "Taken From", "Transfer Note"],
    ["Printer ribbon", "PR-1001", 12, sample, "15/03/2026", "", ""],
  ]);
  ws["!cols"] = [{ wch: 28 }, { wch: 16 }, { wch: 10 }, { wch: 28 }, { wch: 14 }, { wch: 28 }, { wch: 36 }];

  const help = XLSX.utils.aoa_to_sheet([
    ["How to fill in the Supply sheet"],
    ["Required: Goods Supplied, Part Number, Quantity, Client, Supply Date (DD/MM/YYYY)."],
    ["Optional: Taken From = the client whose stock you took this from. Leave blank for normal supply."],
    ["When Taken From is filled in, that client is recorded as OWED the quantity until it is replaced."],
    ["Optional: Transfer Note = why (e.g. urgent job). Defaults to 'Imported from Excel'."],
    ["Client names must match the 'Clients' sheet exactly. Only the first sheet is imported."],
  ]);
  help["!cols"] = [{ wch: 100 }];
  const ref = XLSX.utils.aoa_to_sheet([["Valid Client Names (copy exactly)"], ...clients.map((c) => [c.companyName])]);
  ref["!cols"] = [{ wch: 40 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Supply");
  XLSX.utils.book_append_sheet(wb, ref, "Clients");
  XLSX.utils.book_append_sheet(wb, help, "Help");
  XLSX.writeFile(wb, "zutrad_supply_template.xlsx");
};