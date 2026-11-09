import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { dataDir } from "./db.js";

export const UPLOAD_DIR = path.join(dataDir, "uploads");
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_FILES = 8;

const ALLOWED_EXT = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".doc",
  ".docx",
]);

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function safeExt(originalName) {
  const ext = path.extname(originalName || "").toLowerCase();
  return ALLOWED_EXT.has(ext) ? ext : "";
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = safeExt(file.originalname) || ".bin";
    const name = `${Date.now()}-${crypto.randomBytes(16).toString("hex")}${ext}`;
    cb(null, name);
  },
});

function fileFilter(_req, file, cb) {
  const ext = safeExt(file.originalname);
  const mimeOk = ALLOWED_MIME.has(file.mimetype);
  if (!ext || !mimeOk) {
    return cb(new Error("Tipo de arquivo não permitido. Use PDF, imagem ou Word."));
  }
  cb(null, true);
}

export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
  fileFilter,
}).array("documentos", MAX_FILES);

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
