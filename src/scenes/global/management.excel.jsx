// ─────────────────────────────────────────────────────────────────────────────
// management.excel.jsx – Pure helpers for bulk-importing CLIENTS from an
// Excel / CSV / JSON file and for downloading a blank template.
// No React / JSX in here. Modelled on store.excel.jsx.
//
// Requires the SheetJS package (already used by the Store, Machines, Supply and
// Schedule pages):   npm install xlsx
// It is loaded lazily (dynamic import) so it only costs bundle size when the
// user actually opens the import dialog.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB
export const ACCEPTED_EXT = [".xlsx", ".xls", ".csv", ".json"];

// Must match the limits enforced by POST /clients/bulk on the server.
export const MAX_COMPANY_NAME = 200;
export const MAX_ADDRESS = 300;

// Accepted header spellings → canonical field. Matching ignores case,
// spaces, dots, underscores and punctuation ("Company Name" == "company_name").
const HEADER_ALIASES = {
  companyName: ["companyname", "company", "client", "clientname", "customer", "customername", "name", "organisation", "organization"],
  address:     ["address", "companyaddress", "clientaddress", "location", "street", "streetaddress", "addr"],
};

const REQUIRED_FIELDS = ["companyName", "address"];

export const FIELD_LABELS = {
  companyName: "Company Name",
  address: "Address",
};

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const text = (v) => String(v ?? "").trim();
// Collapse runs of whitespace so "Acme   Ltd" and "Acme Ltd" are the same client.
const cleanCell = (v) => text(v).replace(/\s+/g, " ");

// The same rule the server uses to decide that two company names are the
// same client: case-insensitive, whitespace collapsed.
export const clientNameKey = (name) => cleanCell(name).toLowerCase();

// ── turn a File into a plain grid (array of rows, each an array of cells) ────
const readGrid = async (file, ext) => {
  if (ext === ".json") {
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new Error("Could not read this file. Make sure it is valid JSON.");
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const objects = list.filter((o) => o && typeof o === "object" && !Array.isArray(o));
    if (!objects.length) throw new Error("The JSON file must contain an array of objects, e.g. [{\"companyName\": \"…\", \"address\": \"…\"}].");
    const headers = [];
    objects.forEach((o) => Object.keys(o).forEach((k) => { if (!headers.includes(k)) headers.push(k); }));
    return [headers, ...objects.map((o) => headers.map((h) => o[h]))];
  }

  let XLSX;
  try {
    XLSX = await import("xlsx");
  } catch {
    throw new Error('The "xlsx" package is not installed. Run "npm install xlsx" and restart the dev server.');
  }

  try {
    // CSV is read as text so UTF-8 names (é, ü, …) survive; Excel files as binary.
    const wb = ext === ".csv"
      ? XLSX.read(await file.text(), { type: "string" })
      : XLSX.read(await file.arrayBuffer(), { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error("empty");
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: false });
  } catch {
    throw new Error("Could not read this file. Make sure it is a valid, non-password-protected Excel or CSV file.");
  }
};

// ── parse a File into validated rows ────────────────────────────────────────
// existingNames: names of clients that already exist (used to flag duplicates)
// Returns { rows: [{ rowNum, data, errors, duplicate }], missingColumns: [] }
//   duplicate: false | "exists" (already a client) | "file" (repeated in this file)
// Throws an Error with a user-friendly message for unreadable files.
export const parseClientFile = async (file, existingNames = []) => {
  const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
  if (!ACCEPTED_EXT.includes(ext)) {
    throw new Error("Unsupported file type. Please upload an .xlsx, .xls, .csv or .json file.");
  }
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error("File is larger than 5 MB. Split it into smaller files and import them one at a time.");
  }

  const grid = await readGrid(file, ext);
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
    // A header row must at least contain the company column.
    if (found.companyName !== undefined && Object.keys(found).length > Object.keys(colIdx).length) {
      headerIdx = i;
      colIdx = found;
    }
  }
  if (headerIdx === -1) {
    throw new Error(
      "Could not find the header row. The first row should contain: Company Name, Address. Use the template if unsure."
    );
  }

  const missingColumns = REQUIRED_FIELDS.filter((f) => colIdx[f] === undefined).map((f) => FIELD_LABELS[f]);

  const dataRows = grid.slice(headerIdx + 1).filter((r) => r.some((c) => text(c) !== ""));
  if (dataRows.length === 0) throw new Error("No data rows found under the header.");
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new Error(`This file has ${dataRows.length.toLocaleString()} rows. The maximum per import is ${MAX_IMPORT_ROWS.toLocaleString()}.`);
  }

  const existingKeys = new Set(existingNames.map(clientNameKey));
  const seenInFile = new Set();

  const rows = dataRows.map((r, i) => {
    const get = (f) => (colIdx[f] === undefined ? "" : r[colIdx[f]]);
    const errors = [];

    const companyName = cleanCell(get("companyName"));
    const address = cleanCell(get("address"));

    if (!companyName) errors.push("Company Name is empty");
    else if (companyName.length > MAX_COMPANY_NAME) errors.push(`Company Name is longer than ${MAX_COMPANY_NAME} characters`);
    if (!address) errors.push("Address is empty");
    else if (address.length > MAX_ADDRESS) errors.push(`Address is longer than ${MAX_ADDRESS} characters`);

    let duplicate = false;
    if (!errors.length) {
      const k = clientNameKey(companyName);
      if (existingKeys.has(k)) duplicate = "exists";
      else if (seenInFile.has(k)) duplicate = "file";
      seenInFile.add(k);
    }

    return {
      rowNum: headerIdx + 2 + i, // spreadsheet row number as the user sees it
      data: { companyName, address },
      errors,
      duplicate,
    };
  });

  return { rows, missingColumns };
};

// ── blank template download ─────────────────────────────────────────────────
export const downloadClientTemplate = async () => {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([
    ["Company Name", "Address"],
    ["Example Industries Ltd", "12 Example Road, Lagos"],
  ]);
  ws["!cols"] = [{ wch: 36 }, { wch: 56 }];

  const help = XLSX.utils.aoa_to_sheet([
    ["How to fill in the Clients sheet"],
    ["Required: Company Name and Address, one client per row."],
    ["A client whose Company Name already exists (ignoring upper/lower case) is skipped, not overwritten."],
    [`Company Name: up to ${MAX_COMPANY_NAME} characters.  Address: up to ${MAX_ADDRESS} characters.`],
    ["Only the first sheet is imported. Maximum 5,000 rows per file."],
  ]);
  help["!cols"] = [{ wch: 100 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Clients");
  XLSX.utils.book_append_sheet(wb, help, "Help");
  XLSX.writeFile(wb, "zutrad_clients_template.xlsx");
};
