import {
  Box,
  Typography,
  Button,
  Chip,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
  LinearProgress,
  CircularProgress,
} from "@mui/material";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useImportDialog } from "./management.logic";

// Shared by the Admin and Super Admin pages. Same flow as the Store import:
// choose file → preview with per-row validation → confirm → POST /clients/bulk.
const ClientImportDialog = ({ open, onClose, onImported, colors }) => {
  const {
    importState, importParsing, importing, importProgress, importSummary, importError,
    handleImportFile, confirmImport, handleDownloadTemplate, resetImport,
  } = useImportDialog({ onImported });

  const hasRows = importState.rows.length > 0;

  const handleClose = () => {
    if (importing) return; // don't close mid-upload
    resetImport();
    onClose();
  };

  const handleConfirm = async () => {
    const ok = await confirmImport();
    if (ok) onClose();
  };

  const pickFile = (e) => {
    handleImportFile(e.target.files?.[0]);
    e.target.value = "";
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { backgroundColor: colors.primary[400] } }}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "15px", fontWeight: 700 }}>
        <UploadFileOutlinedIcon sx={{ color: colors.greenAccent[400] }} />
        Import Clients from Excel
      </DialogTitle>

      <DialogContent>
        {/* step 1 — choose file */}
        {!hasRows && !importParsing && (
          <Box display="flex" flexDirection="column" gap="14px" py="4px">
            <Typography color={colors.grey[300]} fontSize="13px">
              Upload an <b>.xlsx</b>, <b>.xls</b>, <b>.csv</b> or <b>.json</b> file. The first row must be a header with
              these columns (any order): <b>Company Name, Address</b>. Both are required. Companies whose name
              already exists are skipped.
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
              <input type="file" hidden accept=".xlsx,.xls,.csv,.json" onChange={pickFile} />
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
        {hasRows && (
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
                  label={`${importSummary.duplicates} duplicate${importSummary.duplicates !== 1 ? "s" : ""} (skipped)`}
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

            {importError && (
              <Alert severity="error" sx={{ fontSize: "12px" }}>{importError}</Alert>
            )}

            <TableContainer sx={{ maxHeight: 340, border: `1px solid ${colors.primary[300]}`, borderRadius: "4px" }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    {["Row", "Company Name", "Address", "Status"].map((h) => (
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
                    const status = bad
                      ? r.errors.join("; ")
                      : r.duplicate === "exists" ? "Already exists (skipped)"
                      : r.duplicate === "file" ? "Repeated in file (skipped)"
                      : "OK";
                    return (
                      <TableRow key={r.rowNum} sx={bad ? { backgroundColor: `${colors.redAccent[900]}66` } : undefined}>
                        <TableCell sx={cell}>{r.rowNum}</TableCell>
                        <TableCell sx={cell}>{r.data.companyName || "—"}</TableCell>
                        <TableCell sx={cell}>{r.data.address || "—"}</TableCell>
                        <TableCell sx={{ ...cell, color: bad ? colors.redAccent[300] : r.duplicate ? colors.grey[300] : colors.greenAccent[300] }}>
                          {status}
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
        <Button size="small" onClick={handleClose} disabled={importing} sx={{ color: colors.grey[400], textTransform: "none" }}>
          Cancel
        </Button>
        {hasRows && (
          <>
            <Button
              size="small" variant="outlined" component="label" disabled={importing}
              sx={{ borderColor: colors.grey[600], color: colors.grey[300], textTransform: "none" }}
            >
              Choose different file
              <input type="file" hidden accept=".xlsx,.xls,.csv,.json" onChange={pickFile} />
            </Button>
            <Button
              size="small" variant="contained" color="secondary"
              disabled={importing || importSummary.toImport === 0}
              onClick={handleConfirm}
              sx={{ textTransform: "none" }}
            >
              Import {importSummary.toImport.toLocaleString()} client{importSummary.toImport === 1 ? "" : "s"}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default ClientImportDialog;
