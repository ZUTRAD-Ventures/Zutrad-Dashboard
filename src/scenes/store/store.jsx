import {
  Box,
  Typography,
  useTheme,
  Button,
  TextField,
  MenuItem,
  Alert,
  Collapse,
  IconButton,
  Tabs,
  Tab,
  Chip,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  LinearProgress,
  CircularProgress,
  FormControlLabel,
  Checkbox,
} from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";
import { tokens } from "../../theme";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import LayersIcon from "@mui/icons-material/Layers";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import SwapHorizOutlinedIcon from "@mui/icons-material/SwapHorizOutlined";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import Header from "../../components/Header";
import {
  MACHINE_TYPES,
  LOW_STOCK_THRESHOLD,
  useStorePage,
} from "./store.logic";

/* =========================================================================
   SUMMARY CARD — small presentational sub-component for the 3 stat tiles
   ========================================================================= */

const SummaryCard = ({ icon, label, value, accent, colors, onClick, active }) => (
  <Box
    onClick={onClick}
    backgroundColor={colors.primary[400]}
    borderRadius="4px"
    p="16px 20px"
    display="flex"
    alignItems="center"
    gap="14px"
    borderLeft={`4px solid ${accent}`}
    flex="1"
    minWidth="180px"
    sx={{
      cursor: onClick ? "pointer" : "default",
      outline: active ? `2px solid ${accent}` : "none",
      transition: "outline 0.15s ease",
    }}
  >
    <Box sx={{ color: accent, display: "flex", alignItems: "center", fontSize: "28px" }}>
      {icon}
    </Box>
    <Box>
      <Typography variant="h4" fontWeight="700" color={colors.grey[100]}>
        {value}
      </Typography>
      <Typography color={colors.grey[400]} fontSize="12px">
        {label}
      </Typography>
    </Box>
  </Box>
);

/* =========================================================================
   DATAGRID COLUMNS — built here (not in the logic file) because the
   quantity column needs JSX (+/- buttons with icons) and theme colors.
   The +/- buttons stay visible/enabled for everyone; adjustQuantity itself
   shows the access-denied dialog if the user lacks store permission.
   The delete column always renders; non-superadmins get a disabled lock
   icon instead of the action being hidden entirely.
   ========================================================================= */

const buildColumns = ({
  isAllTab,
  colors,
  adjustQuantity,
  canDelete,
  handleDelete,
  canSettle,
  openSettle,
}) => [
  { field: "id", headerName: "ID", width: 80 },
  {
    field: "serialNumber",
    headerName: "Serial Number",
    flex: 1,
    cellClassName: "name-column--cell",
  },
  { field: "partNumber", headerName: "Part Number", flex: 1 },
  { field: "machinePart", headerName: "Description", flex: 1.5 },
  ...(isAllTab
    ? [{ field: "machine", headerName: "Machine", flex: 1 }]
    : []),
  {
    field: "quantity",
    headerName: "Qty",
    width: 160,
    type: "number",
    headerAlign: "left",
    align: "left",
    sortComparator: (a, b) => a - b,
    renderCell: ({ row }) => {
      const low = row.quantity <= LOW_STOCK_THRESHOLD;
      return (
        <Box display="flex" alignItems="center" gap="6px">
          <IconButton
            size="small"
            onClick={() => adjustQuantity(row.id, -1)}
            disabled={row.quantity <= 0}
            sx={{ color: colors.redAccent[400], p: "2px" }}
          >
            <RemoveIcon fontSize="small" />
          </IconButton>
          <Typography
            color={low ? colors.redAccent[400] : colors.grey[100]}
            fontWeight={low ? "700" : "400"}
            minWidth="28px"
            textAlign="center"
          >
            {row.quantity}
            {low && " ⚠"}
          </Typography>
          <IconButton
            size="small"
            onClick={() => adjustQuantity(row.id, 1)}
            sx={{ color: colors.greenAccent[400], p: "2px" }}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Box>
      );
    },
  },
  // ── owed to clients — stock already promised to clients it was taken from ──
  // Click the chip (administrators) to record that new stock replaced it.
  {
    field: "owedQty",
    headerName: "Owed to Clients",
    width: 170,
    type: "number",
    headerAlign: "left",
    align: "left",
    renderCell: ({ row }) => {
      if (!row.owedQty)
        return <Typography color={colors.grey[600]} fontSize="12px">—</Typography>;
      const detail = row.owedEntries.map((e) => `${e.companyName}: ${e.owed}`).join("\n");
      return (
        <Tooltip
          title={
            <Box sx={{ whiteSpace: "pre-line", fontSize: "12px" }}>
              {`${detail}\nOn hand ${row.quantity} − owed ${row.owedQty} = ${row.freeQty} free${
                canSettle ? "\nClick to record replacement" : "\n(Administrator records replacements)"
              }`}
            </Box>
          }
        >
          <Chip
            icon={<SwapHorizOutlinedIcon />}
            label={`Owed ${row.owedQty}${row.freeQty < 0 ? " · short" : ""}`}
            size="small"
            onClick={canSettle ? () => openSettle(row.partNumber, row.machinePart, null) : undefined}
            sx={{
              backgroundColor: colors.redAccent[800],
              color: colors.redAccent[200],
              fontSize: "11px",
              cursor: canSettle ? "pointer" : "default",
              "& .MuiChip-icon": { color: colors.redAccent[300], fontSize: "14px" },
            }}
          />
        </Tooltip>
      );
    },
  },
  {
    field: "updatedAtDisplay",
    headerName: "Last Updated",
    flex: 1,
  },
  // ── delete column — always visible; disabled lock icon for non-superadmins ──
  {
    field: "actions",
    headerName: "",
    width: 60,
    sortable: false,
    renderCell: ({ row }) =>
      canDelete ? (
        <Tooltip title="Delete part">
          <IconButton
            size="small"
            onClick={() => handleDelete(row.id)}
            sx={{ color: colors.redAccent[400] }}
          >
            <DeleteOutlineOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : (
        <Tooltip title="Superadmin access required to delete">
          <span>
            <IconButton size="small" disabled sx={{ color: colors.grey[700] }}>
              <LockOutlinedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      ),
  },
];

/* =========================================================================
   MAIN COMPONENT
   ========================================================================= */

const StorePage = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  const {
    rows,
    filtered,
    summary,
    isAllTab,
    currentMachineType,
    activeTab,
    handleTabChange,
    formOpen,
    setFormOpen,
    openFormIfAuthorised,
    form,
    handleFormChange,
    handleAdd,
    adjustQuantity,
    handleDelete,
    search,
    setSearch,
    lowStockOnly,
    toggleLowStockOnly,
    clearLowStockOnly,
    owedOnly,
    toggleOwedOnly,
    clearOwedOnly,
    totalOwed,
    canSettle,
    openSettle,
    settleDialog,
    settling,
    closeSettle,
    changeSettleQty,
    confirmSettle,
    isMock,
    handleExport,
    importState,
    importParsing,
    importing,
    importProgress,
    importSummary,
    skipDuplicates,
    setSkipDuplicates,
    openImportIfAuthorised,
    closeImport,
    handleImportFile,
    confirmImport,
    handleDownloadTemplate,
    confirmDialog,
    closeConfirmDialog,
    submitConfirmDialog,
    successMsg,
    errorDialog,
    closeErrorDialog,
    canAddPart,
    canDelete,
    canExport,
  } = useStorePage();

  const columns = buildColumns({
    isAllTab,
    colors,
    adjustQuantity,
    canDelete,
    handleDelete,
    canSettle,
    openSettle,
  });

  return (
    <Box m="20px">
      {/* ----------------------------------------------------------------
          HEADER + EXPORT BUTTON — always visible; gated inside handleExport
          ---------------------------------------------------------------- */}
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="flex-start"
        flexWrap="wrap"
        gap="12px"
      >
        <Header title="STORE" subtitle="Parts Inventory by Machine Type" />
        <Box display="flex" gap="10px" flexWrap="wrap">
          <Tooltip title={canAddPart ? "Add many parts at once from an Excel or CSV file" : "Store access required"}>
            <span>
              <Button
                variant="outlined"
                startIcon={<UploadFileOutlinedIcon />}
                onClick={openImportIfAuthorised}
                sx={{
                  borderColor: canAddPart ? colors.greenAccent[600] : colors.grey[700],
                  color: canAddPart ? colors.greenAccent[400] : colors.grey[600],
                  height: "40px",
                  "&:hover": {
                    borderColor: canAddPart ? colors.greenAccent[400] : colors.grey[600],
                    backgroundColor: canAddPart ? colors.greenAccent[900] : "transparent",
                  },
                }}
              >
                Import Excel
              </Button>
            </span>
          </Tooltip>
          <Tooltip title={canExport ? "Export to CSV" : "Admin access required to export"}>
            <span>
              <Button
                variant="outlined"
                startIcon={<FileDownloadIcon />}
                onClick={handleExport}
                sx={{
                  borderColor: canExport ? colors.greenAccent[600] : colors.grey[700],
                  color: canExport ? colors.greenAccent[400] : colors.grey[600],
                  height: "40px",
                  "&:hover": {
                    borderColor: canExport ? colors.greenAccent[400] : colors.grey[600],
                    backgroundColor: canExport ? colors.greenAccent[900] : "transparent",
                  },
                }}
              >
                Export CSV ({filtered.length})
              </Button>
            </span>
          </Tooltip>
        </Box>
      </Box>

      {isMock && (
        <Alert severity="warning" sx={{ mb: "16px", mt: "8px", fontSize: "12px" }}>
          Preview mode: parts and owed stock are stored in memory only (see store.preview.jsx). The /store and /supply backends are not connected.
        </Alert>
      )}

      {successMsg && (
        <Alert severity="success" sx={{ mb: "16px", mt: "8px" }}>
          {successMsg}
        </Alert>
      )}

      {/* ----------------------------------------------------------------
          SUMMARY CARDS
          ---------------------------------------------------------------- */}
      <Box display="flex" gap="14px" flexWrap="wrap" mb="20px" mt="16px">
        <SummaryCard
          icon={<Inventory2Icon fontSize="inherit" />}
          label="Total Parts"
          value={summary.totalParts}
          accent={colors.grey[300]}
          colors={colors}
        />
        <SummaryCard
          icon={<LayersIcon fontSize="inherit" />}
          label="Total Quantity on Hand"
          value={summary.totalQuantity}
          accent={colors.blueAccent[400]}
          colors={colors}
        />
        <SummaryCard
          icon={<WarningAmberIcon fontSize="inherit" />}
          label={`Low Stock (≤ ${LOW_STOCK_THRESHOLD})`}
          value={summary.lowStockCount}
          accent="#c0392b"
          colors={colors}
          onClick={toggleLowStockOnly}
          active={lowStockOnly}
        />
        <SummaryCard
          icon={<SwapHorizOutlinedIcon fontSize="inherit" />}
          label="Units Owed to Clients"
          value={totalOwed}
          accent={totalOwed > 0 ? "#c0392b" : colors.grey[500]}
          colors={colors}
          onClick={toggleOwedOnly}
          active={owedOnly}
        />
      </Box>

      {owedOnly && (
        <Chip
          label="Showing parts we owe clients — click again to clear"
          onDelete={clearOwedOnly}
          sx={{
            mb: "16px",
            backgroundColor: "#7a1f1f",
            color: "#ff8a8a",
            fontWeight: "600",
          }}
        />
      )}

      {lowStockOnly && (
        <Chip
          label="Showing low-stock items only — click again to clear"
          onDelete={clearLowStockOnly}
          sx={{
            mb: "16px",
            backgroundColor: "#7a1f1f",
            color: "#ff8a8a",
            fontWeight: "600",
          }}
        />
      )}

      {/* ----------------------------------------------------------------
          MACHINE TYPE TABS (+ All)
          ---------------------------------------------------------------- */}
      <Tabs
        value={activeTab}
        onChange={handleTabChange}
        sx={{
          mb: "20px",
          "& .MuiTab-root": { color: colors.grey[300], fontWeight: "600" },
          "& .Mui-selected": { color: `${colors.greenAccent[400]} !important` },
          "& .MuiTabs-indicator": { backgroundColor: colors.greenAccent[500] },
        }}
      >
        {MACHINE_TYPES.map((t) => (
          <Tab key={t} label={t} />
        ))}
        <Tab label="All" />
      </Tabs>

      {/* ----------------------------------------------------------------
          COLLAPSIBLE "ADD PART" FORM — always visible to everyone.
          Clicking the header uses openFormIfAuthorised so non-store users
          get the access-denied dialog instead of the form opening silently.
          ---------------------------------------------------------------- */}
      <Box mb="16px" backgroundColor={colors.primary[400]} borderRadius="4px" overflow="hidden">
        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          p="12px 16px"
          sx={{ cursor: "pointer" }}
          onClick={() => (formOpen ? setFormOpen(false) : openFormIfAuthorised())}
        >
          <Typography color={canAddPart ? colors.grey[100] : colors.grey[500]} fontWeight="600">
            + Add Part
            {!canAddPart && (
              <Typography component="span" fontSize="11px" color={colors.grey[600]} ml="8px">
                (store access required)
              </Typography>
            )}
          </Typography>
          <IconButton size="small" sx={{ color: canAddPart ? colors.greenAccent[400] : colors.grey[600] }}>
            {formOpen ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
          </IconButton>
        </Box>
        <Collapse in={formOpen}>
          <Box
            p="16px"
            display="grid"
            gridTemplateColumns="repeat(3, 1fr)"
            gap="14px"
            borderTop={`1px solid ${colors.primary[300]}`}
          >
            <TextField variant="filled" label="Serial Number" name="serialNumber" value={form.serialNumber} onChange={handleFormChange} fullWidth />
            <TextField variant="filled" label="Part Number" name="partNumber" value={form.partNumber} onChange={handleFormChange} fullWidth />
            <TextField variant="filled" label="Description" name="machinePart" value={form.machinePart} onChange={handleFormChange} fullWidth />
            <TextField
              variant="filled"
              label="Quantity"
              name="quantity"
              type="number"
              inputProps={{ min: 0 }}
              value={form.quantity}
              onChange={handleFormChange}
              fullWidth
            />
            <TextField
              select
              variant="filled"
              label="Machine Type"
              name="machine"
              value={form.machine}
              onChange={handleFormChange}
              fullWidth
            >
              {MACHINE_TYPES.map((t) => (
                <MenuItem key={t} value={t}>{t}</MenuItem>
              ))}
            </TextField>
            <Box display="flex" alignItems="center" justifyContent="flex-end">
              <Button variant="contained" color="secondary" onClick={handleAdd} sx={{ height: "48px", px: "24px" }}>
                Add Part
              </Button>
            </Box>
          </Box>
        </Collapse>
      </Box>

      {/* ----------------------------------------------------------------
          SEARCH
          ---------------------------------------------------------------- */}
      <TextField
        variant="filled"
        label={isAllTab ? "Search all parts…" : `Search ${currentMachineType} parts…`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        fullWidth
        sx={{ mb: "20px" }}
      />

      {/* ----------------------------------------------------------------
          TABLE
          ---------------------------------------------------------------- */}
      <Box
        height="55vh"
        sx={{
          "& .MuiDataGrid-root": { border: "none" },
          "& .MuiDataGrid-cell": { borderBottom: "none" },
          "& .name-column--cell": { color: colors.greenAccent[300] },
          "& .MuiDataGrid-columnHeaders": {
            backgroundColor: colors.blueAccent[700],
            borderBottom: "none",
          },
          "& .MuiDataGrid-virtualScroller": {
            backgroundColor: colors.primary[400],
          },
          "& .MuiDataGrid-footerContainer": {
            borderTop: "none",
            backgroundColor: colors.blueAccent[700],
          },
        }}
      >
        <DataGrid
          rows={rows}
          columns={columns}
          initialState={{
            pagination: { paginationModel: { pageSize: 10 } },
          }}
          pageSizeOptions={[10, 25, 50]}
        />
      </Box>

      {/* ----------------------------------------------------------------
          ACCESS DENIED / ERROR DIALOG
          ---------------------------------------------------------------- */}
      {/* ----------------------------------------------------------------
          REPLACE OWED STOCK DIALOG
          Opens after stock is added to a part we owe clients (or when an
          administrator clicks the Owed chip).
          ---------------------------------------------------------------- */}
      <Dialog
        open={settleDialog.open}
        onClose={closeSettle}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { backgroundColor: colors.primary[400] } }}
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "15px", fontWeight: 700 }}>
          <SwapHorizOutlinedIcon sx={{ color: colors.greenAccent[400] }} />
          Is this replacing owed stock?
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: colors.grey[300], fontSize: "13px", mb: "14px" }}>
            {settleDialog.restocked != null
              ? <>You added <b>{settleDialog.restocked}</b> × <b>{settleDialog.description}</b> ({settleDialog.partNumber}). </>
              : <><b>{settleDialog.description}</b> ({settleDialog.partNumber}). </>}
            We owe these clients stock for this part. Enter how many units of it
            replace what was taken, or choose “No” if it’s just general stock.
          </DialogContentText>
          <Box display="flex" flexDirection="column" gap="10px">
            {settleDialog.options.map((o) => (
              <Box key={o.clientId} display="flex" alignItems="center" gap="12px">
                <Box flex={1}>
                  <Typography fontSize="13px" color={colors.grey[100]} fontWeight={600}>{o.companyName}</Typography>
                  <Typography fontSize="11px" color={colors.grey[400]}>owed {o.owed}</Typography>
                </Box>
                <TextField
                  variant="filled" size="small" type="number" label="Replaced"
                  value={o.quantity}
                  onChange={(e) => changeSettleQty(o.clientId, e.target.value)}
                  inputProps={{ min: 0, max: o.owed }}
                  sx={{ width: 110 }}
                />
              </Box>
            ))}
            {settleDialog.error && (
              <Alert severity="error" sx={{ fontSize: "12px", py: "2px" }}>{settleDialog.error}</Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: "24px", pb: "16px", gap: "8px" }}>
          <Button size="small" onClick={closeSettle} disabled={settling} sx={{ color: colors.grey[400], textTransform: "none" }}>
            No, keep as general stock
          </Button>
          <Button
            size="small" variant="contained" color="secondary"
            onClick={confirmSettle} disabled={settling}
            sx={{ textTransform: "none" }}
          >
            {settling ? "Saving…" : "Record replacement"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ----------------------------------------------------------------
          EXCEL IMPORT DIALOG — bulk upload of parts (POST /store/bulk)
          ---------------------------------------------------------------- */}
      <Dialog
        open={importState.open}
        onClose={closeImport}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { backgroundColor: colors.primary[400] } }}
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "15px", fontWeight: 700 }}>
          <UploadFileOutlinedIcon sx={{ color: colors.greenAccent[400] }} />
          Import Parts from Excel
        </DialogTitle>

        <DialogContent>
          {/* step 1 — choose file */}
          {importState.rows.length === 0 && !importParsing && (
            <Box display="flex" flexDirection="column" gap="14px" py="4px">
              <Typography color={colors.grey[300]} fontSize="13px">
                Upload an <b>.xlsx</b>, <b>.xls</b> or <b>.csv</b> file. The first row must be a header with these
                columns (any order): <b>Serial Number, Part Number, Description, Machine, Quantity</b>.
                Machine must be one of: {MACHINE_TYPES.join(", ")}. Quantity must be 0 or more.
                {!isAllTab && ` If the file has no Machine column, every row is added to ${currentMachineType}.`}
              </Typography>

              <Box
                component="label"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); handleImportFile(e.dataTransfer.files?.[0]); }}
                sx={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: "8px",
                  p: "28px", cursor: "pointer", borderRadius: "6px",
                  border: `2px dashed ${colors.grey[600]}`,
                  "&:hover": { borderColor: colors.greenAccent[400] },
                }}
              >
                <UploadFileOutlinedIcon sx={{ fontSize: 36, color: colors.greenAccent[400] }} />
                <Typography color={colors.grey[200]} fontSize="13px">
                  Click to choose a file, or drag it here
                </Typography>
                <input
                  type="file" hidden
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => { handleImportFile(e.target.files?.[0]); e.target.value = ""; }}
                />
              </Box>

              {importState.error && (
                <Alert severity="error" sx={{ fontSize: "12px" }}>
                  {importState.fileName ? `${importState.fileName}: ` : ""}{importState.error}
                </Alert>
              )}

              <Box>
                <Button
                  size="small" startIcon={<DownloadOutlinedIcon />}
                  onClick={handleDownloadTemplate}
                  sx={{ color: colors.blueAccent[300], textTransform: "none", fontSize: "12px" }}
                >
                  Download blank template
                </Button>
              </Box>
            </Box>
          )}

          {/* parsing */}
          {importParsing && (
            <Box display="flex" alignItems="center" gap="12px" py="24px" justifyContent="center">
              <CircularProgress size={20} color="secondary" />
              <Typography color={colors.grey[300]} fontSize="13px">Reading {importState.fileName}…</Typography>
            </Box>
          )}

          {/* step 2 — preview */}
          {importState.rows.length > 0 && (
            <Box display="flex" flexDirection="column" gap="12px">
              <Typography color={colors.grey[300]} fontSize="13px">
                <b>{importState.fileName}</b> — {importSummary.total.toLocaleString()} row{importSummary.total !== 1 ? "s" : ""} found
              </Typography>

              <Box display="flex" gap="8px" flexWrap="wrap">
                <Chip
                  icon={<CheckCircleOutlineIcon />}
                  label={`${importSummary.toImport.toLocaleString()} ready to import`}
                  size="small"
                  sx={{ backgroundColor: colors.greenAccent[800], color: colors.greenAccent[200] }}
                />
                {importSummary.invalid > 0 && (
                  <Chip
                    icon={<ErrorOutlineIcon />}
                    label={`${importSummary.invalid} with errors (skipped)`}
                    size="small"
                    sx={{ backgroundColor: colors.redAccent[800], color: colors.redAccent[200] }}
                  />
                )}
                {importSummary.duplicates > 0 && (
                  <Chip
                    icon={<WarningAmberIcon />}
                    label={`${importSummary.duplicates} possible duplicate${importSummary.duplicates !== 1 ? "s" : ""}`}
                    size="small"
                    sx={{ backgroundColor: colors.grey[700], color: colors.grey[100] }}
                  />
                )}
              </Box>

              {importState.missingColumns.length > 0 && (
                <Alert severity="warning" sx={{ fontSize: "12px" }}>
                  Column(s) not found: {importState.missingColumns.join(", ")}. Rows will be marked as errors until they are added.
                </Alert>
              )}

              {importSummary.duplicates > 0 && (
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small" checked={skipDuplicates}
                      onChange={(e) => setSkipDuplicates(e.target.checked)}
                      sx={{ color: `${colors.greenAccent[300]} !important` }}
                    />
                  }
                  label={<Typography fontSize="12px" color={colors.grey[300]}>Skip rows that already exist (same serial number, part number and machine)</Typography>}
                />
              )}

              <TableContainer sx={{ maxHeight: 340, border: `1px solid ${colors.primary[300]}`, borderRadius: "4px" }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      {["Row", "Serial No.", "Part No.", "Description", "Machine", "Qty", "Status"].map((h) => (
                        <TableCell key={h} sx={{ backgroundColor: colors.blueAccent[700], color: colors.grey[100], fontSize: "11px", fontWeight: 700 }}>
                          {h}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {importState.rows.slice(0, 200).map((r) => {
                      const bad = r.errors.length > 0;
                      const cell = { fontSize: "12px", color: bad ? colors.grey[500] : colors.grey[100], borderBottom: `1px solid ${colors.primary[300]}` };
                      return (
                        <TableRow key={r.rowNum} sx={bad ? { backgroundColor: `${colors.redAccent[900]}66` } : undefined}>
                          <TableCell sx={cell}>{r.rowNum}</TableCell>
                          <TableCell sx={cell}>{r.data.serialNumber || "—"}</TableCell>
                          <TableCell sx={cell}>{r.data.partNumber || "—"}</TableCell>
                          <TableCell sx={cell}>{r.data.machinePart || "—"}</TableCell>
                          <TableCell sx={cell}>{r.data.machine || "—"}</TableCell>
                          <TableCell sx={cell}>{r.data.quantity ?? "—"}</TableCell>
                          <TableCell sx={{ ...cell, color: bad ? colors.redAccent[300] : r.duplicate ? colors.grey[300] : colors.greenAccent[300] }}>
                            {bad ? r.errors.join("; ") : r.duplicate ? "Possible duplicate" : "OK"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
              {importState.rows.length > 200 && (
                <Typography color={colors.grey[500]} fontSize="11px">
                  Showing the first 200 of {importState.rows.length.toLocaleString()} rows. All valid rows will be imported.
                </Typography>
              )}

              {importing && (
                <Box>
                  <LinearProgress variant="determinate" value={importProgress} color="secondary" />
                  <Typography color={colors.grey[400]} fontSize="11px" mt="4px">Importing… {importProgress}%</Typography>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ px: "24px", pb: "16px", gap: "8px" }}>
          <Button size="small" onClick={closeImport} disabled={importing} sx={{ color: colors.grey[400], textTransform: "none" }}>
            Cancel
          </Button>
          {importState.rows.length > 0 && (
            <>
              <Button
                size="small" variant="outlined" component="label" disabled={importing}
                sx={{ borderColor: colors.grey[600], color: colors.grey[300], textTransform: "none" }}
              >
                Choose different file
                <input
                  type="file" hidden accept=".xlsx,.xls,.csv"
                  onChange={(e) => { handleImportFile(e.target.files?.[0]); e.target.value = ""; }}
                />
              </Button>
              <Button
                size="small" variant="contained" color="secondary"
                disabled={importing || importSummary.toImport === 0}
                onClick={confirmImport}
                sx={{ textTransform: "none" }}
              >
                Import {importSummary.toImport.toLocaleString()} part{importSummary.toImport === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={errorDialog.open} onClose={closeErrorDialog} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <ErrorOutlineIcon sx={{ color: colors.redAccent[400] }} />
          {errorDialog.title}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: colors.grey[300] }}>
            {errorDialog.message}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeErrorDialog} variant="contained" color="error" size="small">
            OK
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmDialog.open} onClose={closeConfirmDialog} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <DeleteOutlineOutlinedIcon sx={{ color: colors.redAccent[400] }} />
          {confirmDialog.title}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: colors.grey[300] }}>
            {confirmDialog.message}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeConfirmDialog} size="small">
            Cancel
          </Button>
          <Button onClick={submitConfirmDialog} variant="contained" color="error" size="small">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default StorePage;