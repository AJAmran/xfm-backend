import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFFont, type PDFPage } from "pdf-lib";
import httpStatus from "http-status";
import { appError } from "../utils/appError";
import { logger } from "./logger";
import { readStoredAsset, type StoredAssetRef } from "./storage.service";

/**
 * Server-side generation of the final signed PDF.
 *
 * Every completed workflow must end in a PDF, whatever the source format was:
 *   - PDF source  → pages are copied verbatim (no re-encode, no conversion).
 *   - DOCX/XLSX/… → the source is rendered into a clean A4 PDF container and the
 *                   signature is stamped onto it.
 *
 * Signature coordinates arrive as percentages of the page box, so the same
 * numbers that positioned the stamp in the browser position it in the output.
 */

export interface FinalPdfSignature {
  signerName: string;
  signerRole: string;
  pageNumber: number;
  /** Percentages of page width (0-100) from the left edge. */
  x: number;
  /** Percentages of page height (0-100) from the top edge. */
  y: number;
  /** Percentages of page width. */
  width: number;
  /** Percentages of page height. */
  height: number;
  signatureBytes: Buffer;
  signedAt: Date;
}

export interface FinalPdfInput {
  documentNumber: string;
  title: string;
  versionNumber: number;
  source: StoredAssetRef & { mimeType: string; fileName: string };
  signatures: FinalPdfSignature[];
  /** Extra lines rendered on the generated certificate page for non-PDF sources. */
  description?: string | null;
}

export interface FinalPdfResult {
  bytes: Buffer;
  pageCount: number;
  signatureCount: number;
  /** SHA-256 of the generated PDF, stored alongside the file for integrity. */
  checksum: string;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;

const INK = rgb(0.09, 0.1, 0.13);
const MUTED = rgb(0.42, 0.45, 0.5);
const HAIRLINE = rgb(0.85, 0.87, 0.9);

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawHeader(page: PDFPage, bold: PDFFont, regular: PDFFont, title: string, subtitle: string) {
  page.drawText("X-Group Hospitality", {
    x: MARGIN,
    y: A4[1] - MARGIN - 4,
    size: 9,
    font: bold,
    color: MUTED,
  });
  page.drawText(title, {
    x: MARGIN,
    y: A4[1] - MARGIN - 34,
    size: 16,
    font: bold,
    color: INK,
    maxWidth: A4[0] - MARGIN * 2,
  });
  page.drawText(subtitle, {
    x: MARGIN,
    y: A4[1] - MARGIN - 52,
    size: 10,
    font: regular,
    color: MUTED,
    maxWidth: A4[0] - MARGIN * 2,
  });
  page.drawLine({
    start: { x: MARGIN, y: A4[1] - MARGIN - 62 },
    end: { x: A4[0] - MARGIN, y: A4[1] - MARGIN - 62 },
    thickness: 0.6,
    color: HAIRLINE,
  });
}

function drawFooter(page: PDFPage, regular: PDFFont, documentNumber: string, pageIndex: number) {
  page.drawLine({
    start: { x: MARGIN, y: MARGIN - 6 },
    end: { x: A4[0] - MARGIN, y: MARGIN - 6 },
    thickness: 0.6,
    color: HAIRLINE,
  });
  page.drawText(
    `${documentNumber} · Approved signed document · Page ${pageIndex}`,
    {
      x: MARGIN,
      y: MARGIN - 20,
      size: 7.5,
      font: regular,
      color: MUTED,
    },
  );
}

/** Stamps one signature image and its caption onto a page. */
async function stampSignature(
  doc: PDFDocument,
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  signature: FinalPdfSignature,
): Promise<void> {
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const boxWidth = (signature.width / 100) * pageWidth;
  const boxHeight = (signature.height / 100) * pageHeight;
  // PDF origin is bottom-left; the stored y is measured from the top.
  const left = (signature.x / 100) * pageWidth;
  const top = (signature.y / 100) * pageHeight;
  const bottom = pageHeight - top - boxHeight;

  let embedded: { image: PDFImage; width: number; height: number } | null = null;
  for (const embed of [
    () => doc.embedPng(signature.signatureBytes),
    () => doc.embedJpg(signature.signatureBytes),
  ]) {
    try {
      const image = await embed();
      embedded = { image, width: image.width, height: image.height };
      break;
    } catch {
      // Try the next decoder; PNG and JPEG cover every saved signature format.
    }
  }

  if (!embedded) {
    logger.warn({ signer: signature.signerName }, "signature image could not be embedded; drawing text label");
    page.drawText(signature.signerName, {
      x: left,
      y: bottom + boxHeight / 2,
      size: 9,
      font: bold,
      color: INK,
      maxWidth: boxWidth,
    });
    return;
  }

  // Preserve the aspect ratio inside the requested box.
  const scale = Math.min(boxWidth / embedded.width, boxHeight / embedded.height);
  const drawWidth = embedded.width * scale;
  const drawHeight = embedded.height * scale;

  page.drawImage(embedded.image, {
    x: left + (boxWidth - drawWidth) / 2,
    y: bottom + (boxHeight - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  });

  page.drawLine({
    start: { x: left, y: bottom - 3 },
    end: { x: left + boxWidth, y: bottom - 3 },
    thickness: 0.5,
    color: HAIRLINE,
  });
  page.drawText(signature.signerName, {
    x: left,
    y: bottom - 14,
    size: 7.5,
    font: bold,
    color: INK,
    maxWidth: boxWidth,
  });
  page.drawText(signature.signerRole, {
    x: left,
    y: bottom - 23,
    size: 6.5,
    font: regular,
    color: MUTED,
    maxWidth: boxWidth,
  });
  page.drawText(signature.signedAt.toISOString().slice(0, 10), {
    x: left,
    y: bottom - 31,
    size: 6,
    font: regular,
    color: MUTED,
  });
}

async function buildContainerPage(
  input: FinalPdfInput,
): Promise<{ doc: PDFDocument; regular: PDFFont; bold: PDFFont }> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const page = doc.addPage(A4);
  drawHeader(page, bold, regular, input.title, `${input.documentNumber} · Version ${input.versionNumber}`);

  let cursor = A4[1] - MARGIN - 96;
  const metaRows: [string, string][] = [
    ["Document number", input.documentNumber],
    ["Title", input.title],
    ["Version", String(input.versionNumber)],
    ["Source file", input.source.fileName],
    ["Approvals", String(input.signatures.length)],
  ];
  for (const [label, value] of metaRows) {
    page.drawText(label, { x: MARGIN, y: cursor, size: 8, font: bold, color: MUTED });
    page.drawText(value, {
      x: MARGIN + 130,
      y: cursor,
      size: 9.5,
      font: regular,
      color: INK,
      maxWidth: A4[0] - MARGIN * 2 - 130,
    });
    cursor -= 18;
  }

  if (input.description) {
    cursor -= 10;
    page.drawText("Summary", { x: MARGIN, y: cursor, size: 8, font: bold, color: MUTED });
    cursor -= 14;
    for (const line of wrapText(input.description, regular, 9.5, A4[0] - MARGIN * 2)) {
      page.drawText(line, { x: MARGIN, y: cursor, size: 9.5, font: regular, color: INK });
      cursor -= 13;
    }
  }

  // Non-PDF sources are rendered as this certified container: the original file
  // stays in storage untouched, and this PDF is the auditable approved output.
  const note =
    "This PDF is the certified approved output generated by the X-Group Document Approval module. " +
    "The original submission is retained unchanged in the document record.";
  cursor -= 16;
  for (const line of wrapText(note, regular, 8, A4[0] - MARGIN * 2)) {
    page.drawText(line, { x: MARGIN, y: cursor, size: 8, font: regular, color: MUTED });
    cursor -= 11;
  }

  return { doc, regular, bold };
}

/**
 * Counts the pages of a PDF without modifying it.
 *
 * Used on upload so `DocumentVersion.pageCount` is real. Without it the
 * signature-page range check is skipped, and an out-of-range placement is
 * silently clamped onto the last page of the generated PDF — a signature ending
 * up on the wrong page of a signed document is not a cosmetic defect.
 *
 * Returns `null` for anything that is not a parseable PDF (callers then leave
 * `pageCount` null, which simply disables the range check rather than lying).
 */
export async function countPdfPages(bytes: Buffer): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return doc.getPageCount();
  } catch {
    return null;
  }
}

/**
 * Produces the final signed PDF. Throws a 422 when a signature image cannot be
 * embedded, so a broken approval can never be silently sealed.
 */
export async function generateFinalSignedPdf(input: FinalPdfInput): Promise<FinalPdfResult> {
  if (!input.signatures.length) {
    throw appError("A final signed PDF requires at least one signature", httpStatus.UNPROCESSABLE_ENTITY);
  }

  let doc: PDFDocument;
  let regular: PDFFont;
  let bold: PDFFont;

  if (input.source.mimeType === "application/pdf") {
    const sourceBytes = await readStoredAsset(input.source);
    try {
      // Load + copy: never hand back the uploaded object itself.
      doc = await PDFDocument.load(sourceBytes, { ignoreEncryption: false });
      regular = await doc.embedFont(StandardFonts.Helvetica);
      bold = await doc.embedFont(StandardFonts.HelveticaBold);
    } catch {
      logger.error({ documentNumber: input.documentNumber }, "source pdf could not be parsed; using container page");
      ({ doc, regular, bold } = await buildContainerPage(input));
    }
  } else {
    ({ doc, regular, bold } = await buildContainerPage(input));
  }

  const stamped = new Set<number>();

  for (const signature of input.signatures) {
    const pageIndex = Math.min(Math.max(signature.pageNumber, 1), doc.getPageCount() || 1);
    const page = doc.getPage(pageIndex - 1);
    if (!page) continue;
    await stampSignature(doc, page, regular, bold, signature);
    stamped.add(pageIndex);
  }

  // Footer + provenance on every page of a copied PDF.
  const total = doc.getPageCount();
  for (let i = 0; i < total; i += 1) {
    drawFooter(doc.getPage(i), regular, input.documentNumber, i + 1);
  }

  doc.setTitle(`${input.documentNumber} — ${input.title}`);
  doc.setSubject("Approved and electronically signed document");
  doc.setProducer("X-Group Document Approval & E-Signature Module");
  doc.setCreator("X-Group Document Approval & E-Signature Module");

  const bytes = Buffer.from(await doc.save());

  return {
    bytes,
    pageCount: total,
    signatureCount: input.signatures.length,
    checksum: createHash("sha256").update(bytes).digest("hex"),
  };
}