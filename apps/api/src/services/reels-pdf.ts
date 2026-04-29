/**
 * Generate a PDF export of a Reels script using pdfkit.
 *
 * Layout: cover (title + duration + chosen hook), beats table, caption,
 * B-roll list, voice-over, edit notes. The user prints/saves to feed their
 * production crew.
 */

import PDFDocument from "pdfkit";
import type { ReelsScriptRow } from "../db/repositories/reels-scripts.js";

export async function buildReelsPdf(reel: ReelsScriptRow): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: reel.title } });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk as Buffer));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Cover
      doc.fontSize(22).fillColor("#0f172a").text(reel.title, { align: "left" });
      doc.moveDown(0.3);
      doc
        .fontSize(11)
        .fillColor("#6b7280")
        .text(`Duração-alvo: ${reel.target_duration}s`);
      if (reel.theme) doc.text(`Tema: ${reel.theme}`);
      doc.moveDown();

      if (reel.chosen_hook) {
        doc.fontSize(13).fillColor("#0f172a").text("HOOK", { underline: true });
        doc.moveDown(0.2);
        doc.fontSize(14).fillColor("#22c55e").text(reel.chosen_hook);
        doc.moveDown();
      }

      // Beats table
      if (reel.beats.length > 0) {
        doc.fontSize(13).fillColor("#0f172a").text("BEATS", { underline: true });
        doc.moveDown(0.5);

        for (const b of reel.beats) {
          doc
            .fontSize(11)
            .fillColor("#22c55e")
            .text(`${b.start_seconds.toFixed(1)}s – ${b.end_seconds.toFixed(1)}s`, { continued: true });
          doc.fillColor("#9ca3af").text(`   beat ${b.index + 1}`);
          doc.moveDown(0.2);

          doc.fontSize(11).fillColor("#0f172a").text("Visual: ", { continued: true });
          doc.fillColor("#334155").text(b.visual);

          if (b.on_camera_speech) {
            doc.fontSize(11).fillColor("#0f172a").text("Fala: ", { continued: true });
            doc.fillColor("#334155").text(b.on_camera_speech);
          }
          if (b.on_screen_text) {
            doc.fontSize(11).fillColor("#0f172a").text("Texto na tela: ", { continued: true });
            doc.fillColor("#334155").text(b.on_screen_text);
          }
          if (b.broll_hint) {
            doc.fontSize(11).fillColor("#0f172a").text("B-roll: ", { continued: true });
            doc.fillColor("#334155").text(b.broll_hint);
          }
          doc.moveDown(0.6);
        }
      }

      // Caption
      if (reel.caption) {
        ensurePageRoom(doc, 100);
        doc.fontSize(13).fillColor("#0f172a").text("CAPTION", { underline: true });
        doc.moveDown(0.3);
        doc.fontSize(11).fillColor("#334155").text(reel.caption);
        doc.moveDown();

        if (reel.cta) {
          doc.fontSize(11).fillColor("#0f172a").text("CTA: ", { continued: true });
          doc.fillColor("#22c55e").text(reel.cta);
          doc.moveDown(0.5);
        }

        if (reel.hashtags.length > 0) {
          const tags = reel.hashtags
            .map((t) => (t.startsWith("#") ? t : `#${t}`))
            .join(" ");
          doc.fontSize(10).fillColor("#9ca3af").text(tags);
          doc.moveDown();
        }
      }

      // B-roll
      if (reel.broll_suggestions.length > 0) {
        ensurePageRoom(doc, 80);
        doc.fontSize(13).fillColor("#0f172a").text("B-ROLL A GRAVAR", { underline: true });
        doc.moveDown(0.3);
        doc.fontSize(11).fillColor("#334155");
        for (const b of reel.broll_suggestions) {
          doc.text(`•  ${b}`, { indent: 0 });
        }
        doc.moveDown();
      }

      // Voice-over
      if (reel.voice_over_script) {
        ensurePageRoom(doc, 100);
        doc.fontSize(13).fillColor("#0f172a").text("VOICE-OVER (script completo)", { underline: true });
        doc.moveDown(0.3);
        doc.fontSize(11).fillColor("#334155").text(reel.voice_over_script, { lineGap: 2 });
        doc.moveDown();
      }

      // Edit notes
      if (reel.edit_notes) {
        ensurePageRoom(doc, 60);
        doc.fontSize(13).fillColor("#0f172a").text("NOTAS DE EDIÇÃO", { underline: true });
        doc.moveDown(0.3);
        doc.fontSize(11).fillColor("#334155").text(reel.edit_notes);
      }

      doc.end();
    } catch (e) {
      reject(e as Error);
    }
  });
}

function ensurePageRoom(doc: PDFKit.PDFDocument, needed: number) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}
