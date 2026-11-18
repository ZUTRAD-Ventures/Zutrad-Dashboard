// ─────────────────────────────────────────────────────────────────────────────
// store.excel.jsx – Pure helpers for bulk-importing STORE parts from an
// Excel/CSV file and for downloading a blank template. No React / JSX in here.
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
  serialNumber: ["serialnumber", "serialno", "serialnum", "serial", "sn", "slno"],
  partNumber:   ["partnumber", "partno", "partnum", "part", "pn", "partcode", "sku"],
  machinePart:  ["description", "machinepart", "partdescription", "partname", "item", "items", "product", "goods"],
  machine:      ["machine", "machinetype", "type", "machinemodel"],
  quantity:     ["quantity", "qty", "units", "stock", "onhand", "qtyinstock", "amount"],
};

// Columns that must exist. (Machine becomes optional when the caller passes a
// defaultMachine — e.g. the machine tab the user is currently on.)
const REQUIRED_FIELDS = ["serialNumber", "partNumber", "machinePart", "machine", "quantity"];

export const FIELD_LABELS = {
  serialNumber: "Serial Number",
  partNumber: "Part Number",
  machinePart: "Description",
  machine: "Machine",
  quantity: "Quantity",
};

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const text = (v) => String(v ?? "").trim();

// Same rule as the Add Part form: a number that is 0 or greater.
const parseQuantity = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
};

// ── parse a File into validated rows ────────────────────────────────────────
// machineTypes:   ["Macsa ID", "Savema", ...]   (valid values for Machine)
// existing:       current store items (used to flag duplicates)
// opts.defaultMachine: used for every row when the file has no Machine column
// Returns { rows: [{ rowNum, data, errors, duplicate }], missingColumns: [] }
// Throws an Error with a user-friendly message for unreadable files.
export const parseStoreFile = async (file, machineTypes, existing = [], opts = {}) => {
  const { defaultMachine = "" } = opts;
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
    const wb = XLSX.read(buf, { type: "array" });
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
      "Could not find the header row. The first row should contain: Serial Number, Part Number, Description, Machine, Quantity. Use the template if unsure."
    );
  }

  const missingColumns = REQUIRED_FIELDS
    .filter((f) => colIdx[f] === undefined)
    .filter((f) => !(f === "machine" && defaultMachine))
    .map((f) => FIELD_LABELS[f]);

  const dataRows = grid.slice(headerIdx + 1).filter((r) => r.some((c) => text(c) !== ""));
  if (dataRows.length === 0) throw new Error("No data rows found under the header.");
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new Error(`This file has ${dataRows.length.toLocaleString()} rows. The maximum per import is ${MAX_IMPORT_ROWS.toLocaleString()}.`);
  }

  const machineByName = new Map(machineTypes.map((m) => [norm(m), m]));
  const keyOf = (serial, part, machine) => [norm(serial), norm(part), norm(machine)].join("|");
  const existingKeys = new Set(existing.map((r) => keyOf(r.serialNumber, r.partNumber, r.machine)));
  const seenInFile = new Set();

  const rows = dataRows.map((r, i) => {
    const get = (f) => (colIdx[f] === undefined ? "" : r[colIdx[f]]);
    const errors = [];

    const serialNumber = text(get("serialNumber"));
    const partNumber = text(get("partNumber"));
    const machinePart = text(get("machinePart"));
    const quantity = parseQuantity(get("quantity"));

    const machineRaw = colIdx.machine === undefined ? defaultMachine : text(get("machine"));
    const machine = machineByName.get(norm(machineRaw));

    if (!serialNumber) errors.push("Serial Number is empty");
    if (!partNumber) errors.push("Part Number is empty");
    if (!machinePart) errors.push("Description is empty");
    if (quantity === null) errors.push("Quantity must be a number that is 0 or greater");
    if (!machineRaw) errors.push("Machine is empty");
    else if (!machine) errors.push(`Machine "${machineRaw}" not recognised (use: ${machineTypes.join(", ")})`);

    let duplicate = false;
    if (!errors.length) {
      const k = keyOf(serialNumber, partNumber, machine);
      duplicate = existingKeys.has(k) || seenInFile.has(k);
      seenInFile.add(k);
    }

    return {
      rowNum: headerIdx + 2 + i, // spreadsheet row number as the user sees it
      data: { serialNumber, partNumber, machinePart, machine: machine ?? machineRaw, quantity },
      errors,
      duplicate,
    };
  });

  return { rows, missingColumns };
};

// ── blank template download ─────────────────────────────────────────────────
export const downloadStoreTemplate = async (machineTypes) => {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([
    ["Serial Number", "Part Number", "Description", "Machine", "Quantity"],
    ["SN-1001", "PR-1001", "Printer ribbon", machineTypes[0] ?? "Macsa ID", 12],
  ]);
  ws["!cols"] = [{ wch: 18 }, { wch: 16 }, { wch: 32 }, { wch: 16 }, { wch: 10 }];

  const help = XLSX.utils.aoa_to_sheet([
    ["How to fill in the Store sheet"],
    ["Required: Serial Number, Part Number, Description, Machine, Quantity."],
    ["Machine must be one of the names on the 'Machines' sheet.  Quantity must be 0 or more."],
    ["Rows whose Serial Number + Part Number + Machine already exist in the Store are flagged as possible duplicates."],
    ["Only the first sheet is imported. Maximum 5,000 rows per file."],
  ]);
  help["!cols"] = [{ wch: 100 }];
  const ref = XLSX.utils.aoa_to_sheet([["Valid Machine Names (copy exactly)"], ...machineTypes.map((m) => [m])]);
  ref["!cols"] = [{ wch: 36 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Store");
  XLSX.utils.book_append_sheet(wb, ref, "Machines");
  XLSX.utils.book_append_sheet(wb, help, "Help");
  XLSX.writeFile(wb, "zutrad_store_template.xlsx");
};
