import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import PDFDocument from "pdfkit";
import { dataDir } from "./db.js";

export const CONTRACTS_DIR = path.join(dataDir, "contracts");
fs.mkdirSync(CONTRACTS_DIR, { recursive: true });

function writeWrapped(doc, text, options = {}) {
  doc.fontSize(options.size || 10)
    .fillColor(options.color || "#161210")
    .text(text, {
      align: options.align || "justify",
      lineGap: options.lineGap ?? 2,
      paragraphGap: options.paragraphGap ?? 6,
    });
}

export function generateContractPdfBuffer(document) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 56, bottom: 56, left: 56, right: 56 },
      info: {
        Title: document.titulo,
        Author: "Cavalcante e Valduga",
        Subject: "Contrato de consultoria — dívidas rurais",
      },
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc
      .fillColor("#09203d")
      .fontSize(11)
      .font("Helvetica-Bold")
      .text("CAVALCANTE E VALDUGA", { align: "left" });
    doc
      .moveTo(56, doc.y + 4)
      .lineTo(200, doc.y + 4)
      .strokeColor("#e8bc67")
      .lineWidth(2)
      .stroke();
    doc.moveDown(1.2);

    doc
      .fillColor("#09203d")
      .fontSize(12)
      .font("Helvetica-Bold")
      .text(document.titulo, { align: "center" });
    doc.moveDown(1);

    doc.font("Helvetica");
    writeWrapped(doc, document.introducao, { size: 10 });
    doc.moveDown(0.6);

    for (const clause of document.clausulas) {
      doc
        .font("Helvetica-Bold")
        .fillColor("#09203d")
        .fontSize(10.5)
        .text(`CLÁUSULA ${clause.numero} — ${clause.titulo.toUpperCase()}`);
      doc.moveDown(0.25);
      doc.font("Helvetica");
      writeWrapped(doc, clause.texto, { size: 10 });
      doc.moveDown(0.45);
    }

    writeWrapped(doc, document.fechamento, { size: 10 });
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").text(document.local_data, { align: "left" });
    doc.moveDown(1.6);

    const colW = (doc.page.width - 112) / 2;
    const y = doc.y;
    doc
      .font("Helvetica")
      .fontSize(10)
      .text("________________________________", 56, y, { width: colW - 10 });
    doc.text("CONTRATADO", 56, y + 14, { width: colW - 10 });
    doc.text("________________________________", 56 + colW, y, { width: colW - 10 });
    doc.text("CONTRATANTE", 56 + colW, y + 14, { width: colW - 10 });

    doc.moveDown(4);
    doc
      .fontSize(8)
      .fillColor("#6f6561")
      .text(
        `Template ${document.template_id} v${document.template_versao} · documento gerado automaticamente — revisar dados antes da assinatura.`,
        { align: "center" }
      );

    doc.end();
  });
}

export async function saveContractPdf(document, leadId) {
  const buffer = await generateContractPdfBuffer(document);
  const nomeSalvo = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-lead${leadId}.pdf`;
  const full = path.join(CONTRACTS_DIR, nomeSalvo);
  fs.writeFileSync(full, buffer);
  return { buffer, nomeSalvo, fullPath: full, bytes: buffer.length };
}
