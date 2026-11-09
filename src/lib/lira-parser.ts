// @ts-nocheck -- strict index checks are noisy for PDF geometry code
import type { Hazard } from "./report-types";
import { uid } from "./report-types";

interface Line {
  text: string;
  y: number; // top-down position on page (viewport px)
}
interface Img {
  y: number;
  rect: [number, number, number, number]; // x, y, w, h in viewport px
}

export interface LiraResult {
  hazards: Hazard[];
  raCompany: string;
  raDate: string; // ISO yyyy-mm-dd
  address: string;
}

type Mat = [number, number, number, number, number, number];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

function toIso(d: string): string {
  const m = d.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function titleCaseLoc(room: string, feature: string, loc: string): string {
  if (/exterior/i.test(room)) {
    if (/entrance/i.test(feature)) return "Dwelling Entrance";
    return loc ? `Exterior Side ${loc}` : "Exterior";
  }
  return [room, loc ? `Side ${loc}` : ""].filter(Boolean).join(" ");
}

/**
 * Reads a Fulcrum-style LIRA report and returns every lead-positive XRF test
 * with the photo(s) that follow its "Positive XRF Photos" label.
 */
export async function parseLira(
  data: ArrayBuffer,
  onProgress?: (p: number) => void,
): Promise<LiraResult> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
  const SCALE = 2;

  type Entry = {
    fields: Record<string, string>;
    photos: string[];
    expectPhotos: boolean;
  };
  const entries: Entry[] = [];
  let current: Entry | null = null;
  let fullText = "";

  for (let p = 1; p <= doc.numPages; p++) {
    onProgress?.(p / doc.numPages);
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: SCALE });

    // --- text lines
    const tc = await page.getTextContent();
    const raw: { s: string; x: number; y: number }[] = [];
    for (const it of tc.items as { str: string; transform: number[] }[]) {
      if (!it.str?.trim()) continue;
      const [, vy] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
      raw.push({ s: it.str, x: it.transform[4], y: vy });
    }
    raw.sort((a, b) => a.y - b.y || a.x - b.x);
    const lines: Line[] = [];
    for (const r of raw) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - r.y) < 4 * SCALE) last.text += " " + r.s;
      else lines.push({ text: r.s, y: r.y });
    }
    fullText += lines.map((l) => l.text).join("\n") + "\n";

    // --- image placements
    const ops = await page.getOperatorList();
    const imgs: Img[] = [];
    let ctm: Mat = [1, 0, 0, 1, 0, 0];
    const stack: Mat[] = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i];
      if (fn === pdfjs.OPS.save) stack.push(ctm);
      else if (fn === pdfjs.OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      else if (fn === pdfjs.OPS.transform) ctm = mul(ctm, args as Mat);
      else if (
        fn === pdfjs.OPS.paintImageXObject ||
        fn === pdfjs.OPS.paintJpegXObject ||
        fn === pdfjs.OPS.paintInlineImageXObject
      ) {
        const corners = [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ].map(([u, v]) =>
          viewport.convertToViewportPoint(ctm[0] * u + ctm[2] * v + ctm[4], ctm[1] * u + ctm[3] * v + ctm[5]),
        );
        const xs = corners.map((c) => c[0]);
        const ys = corners.map((c) => c[1]);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        const w = Math.max(...xs) - x;
        const h = Math.max(...ys) - y;
        // ignore logos/footers/icons
        if (w < 100 * SCALE || h < 80 * SCALE) continue;
        if (y + h > viewport.height * 0.94 || y < viewport.height * 0.03) continue;
        imgs.push({ y, rect: [x, y, w, h] });
      }
    }

    // --- walk text + images in reading order
    type Ev = { y: number; line?: string; img?: Img };
    const evs: Ev[] = [
      ...lines.map((l) => ({ y: l.y, line: l.text })),
      ...imgs.map((im) => ({ y: im.y, img: im })),
    ].sort((a, b) => a.y - b.y);

    let canvas: HTMLCanvasElement | null = null;
    const getCanvas = async () => {
      if (canvas) return canvas;
      canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport, canvas } as never).promise;
      return canvas;
    };

    for (const ev of evs) {
      if (ev.line !== undefined) {
        const t = ev.line.replace(/\s+/g, " ").trim();
        if (/XRF .*Paint Tests\s*-\s*\d+\.\s*\d+/i.test(t)) {
          current = { fields: {}, photos: [], expectPhotos: false };
          entries.push(current);
          continue;
        }
        if (/^XRF .*\(\d+ Items\)/i.test(t) || /Calibrations/i.test(t)) {
          current = null;
          continue;
        }
        if (!current) continue;
        const m = t.match(
          /^(XRF Shot #|Room \(XRF\)|Building Feature \(XRF\)|Component \(XRF\)|Substrate \(XRF\)|Location \(XRF\)|Paint Color \(XRF\)|Condition \(XRF\)|X[RF]{2} Result: \(mg\/cm²\)|X[RF]{2} Result: \(mg\/cm2\)|Lead Present:)\s*(.*)$/i,
        );
        if (m) current.fields[m[1].replace(/^XFR/i, "XRF").replace(/\s*\(.*$/, "").replace(/:$/, "").toLowerCase()] = m[2].trim();
        if (/Positive XRF Photos/i.test(t)) current.expectPhotos = true;
      } else if (ev.img && current?.expectPhotos) {
        const c = await getCanvas();
        const [x, y, w, h] = ev.img.rect;
        const out = document.createElement("canvas");
        out.width = Math.round(w);
        out.height = Math.round(h);
        out.getContext("2d")!.drawImage(c, x, y, w, h, 0, 0, w, h);
        current.photos.push(out.toDataURL("image/jpeg", 0.85));
      }
    }
    page.cleanup();
  }

  const hazards: Hazard[] = entries
    .filter((e) => {
      if (!/^yes/i.test(e.fields["lead present"] ?? "")) return false;
      // Skip tests marked "Yes" whose reading is below the 1.0 mg/cm² lead-based paint threshold (data-entry mistakes).
      const v = parseFloat((e.fields["xrf result:"] ?? e.fields["xrf result"] ?? "").replace(/[^\d.\-]/g, ""));
      return isNaN(v) || v >= 1.0;
    })
    .map((e) => ({
      id: uid(),
      location: titleCaseLoc(e.fields["room"] ?? "", e.fields["building feature"] ?? "", e.fields["location"] ?? ""),
      component: e.fields["component"] || e.fields["building feature"] || "",
      substrate: e.fields["substrate"] ?? "",
      status: "Pass" as const,
      before: e.photos[0] ?? null,
      after: null,
      xrf: e.fields["xrf result:"] ?? e.fields["xrf result"] ?? "",
    }));

  const company =
    fullText.match(/conducted by\s+([A-Z][\w&.\- ]+?)(?:,|\s+Environmental|\s+LLC)/)?.[1]?.trim() ??
    fullText.match(/^\s*([A-Z]{3,})\s*$/m)?.[1] ??
    "";
  const dateMatch = fullText.match(/(\d{1,2}\/\d{1,2}\/\d{4}),\s*\d{1,2}:\d{2}/);
  const address = fullText.match(/conducted at\s+(.+?)\s+at the request/s)?.[1]?.replace(/\s+/g, " ") ?? "";

  return {
    hazards,
    raCompany: company,
    raDate: dateMatch ? toIso(dateMatch[1]) : "",
    address,
  };
}

/** Number of pages in an uploaded PDF (used for preview hints). */
export async function pdfPageCount(data: ArrayBuffer): Promise<number> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
  return doc.numPages;
}

export interface LabSample { sampleId: string; location: string; result: string; standard: string; sampled: string }

/** Dust-wipe clearance standard (µg/ft²) by surface. */
export function standardFor(location: string): string {
  if (/trough|well/i.test(location)) return "100";
  if (/sill|stool/i.test(location)) return "40";
  return "5.0";
}

/** Pure text parser for EMSL-style lab reports ("Client Sample ID: 1/Kitchen Floor ... Lead <2.0 µg/ft²"). */
export function parseLabText(text: string): LabSample[] {
  const out: LabSample[] = [];
  const re = /Client Sample ID:\s*([^\/\n]+?)\s*\/\s*(.+?)\s+Date Sampled:\s*([\d\/]+)[\s\S]*?Lead\s+(<?\s*[\d.]+)\s*µg\/ft/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const location = m[2].replace(/\s+/g, " ").trim();
    out.push({ sampleId: m[1].trim(), location, result: m[4].replace(/\s+/g, " ").replace(/^</, "< "), standard: standardFor(location), sampled: m[3] });
  }
  return out;
}

export async function parseLabPdf(data: ArrayBuffer): Promise<LabSample[]> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
  let text = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = (tc.items as { str: string; transform: number[] }[]).filter(i => i.str?.trim());
    items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
    let lastY: number | null = null;
    for (const it of items) { text += (lastY !== null && Math.abs(lastY - it.transform[5]) > 3 ? "\n" : " ") + it.str; lastY = it.transform[5]; }
    text += "\n";
  }
  return parseLabText(text);
}
