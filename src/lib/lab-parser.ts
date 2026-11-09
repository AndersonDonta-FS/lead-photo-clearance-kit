// src/lib/lab-parser.ts
// Reads dust-wipe results from an EMSL lead lab report (text PDF) so the
// "Dust wipe results" step can be filled in automatically.

export type LabSample = {
  sampleId: string;   // "1"
  location: string;   // "DE 2 Floor"
  result: string;     // "<2.0" (kept as printed so the report matches the lab)
  standard: string;   // clearance standard in µg/ft² (not printed on the lab report)
  sampled: string;    // "10/28/26"
};

// The lab report does not list a clearance standard, so pick one from the surface.
// EPA clearance levels (2024 rule): floors 10, window sills 100, window troughs 400 µg/ft².
// Confirm against the policy you work under.
export function clearanceStandard(location: string): string {
  if (/\btrough/i.test(location)) return "400";
  if (/\b(sill|stool)/i.test(location)) return "100";
  return "10";
}

// Fix typos that come from the handwritten chain of custody.
function cleanLocation(s: string): string {
  return s.replace(/\s+/g, " ").trim().replace(/\bLivng\b/gi, "Living");
}

// Pure text parser: works on the text of the results page(s).
export function parseLabText(text: string): LabSample[] {
  const re =
    /Client Sample ID:\s*([\s\S]+?)\s+Date Sampled:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})[\s\S]*?\bLead\s+(<?\s*[\d,]*\.?\d+)\s*[µμu]g\s*\/\s*ft/gi;
  const out: LabSample[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const idText = m[1].replace(/\s+/g, " ").trim();          // "1/DE 2 Floor"
    const split = idText.match(/^(\d+)\s*\/\s*(.+)$/);
    const sampleId = split ? split[1] : String(out.length + 1);
    const location = cleanLocation(split ? split[2] : idText);
    out.push({
      sampleId,
      location,
      result: m[3].replace(/[\s,]/g, ""),                       // "<2.0"
      standard: clearanceStandard(location),
      sampled: m[2],
    });
  }
  return out;
}

// PDF reader: pulls the text of every page, rebuilding lines from item positions.
export async function parseLabPdf(buf: ArrayBuffer): Promise<LabSample[]> {
  const pdfjs: any = await import("pdfjs-dist");
  // Use the same worker setup as lira-parser.ts. If that file already sets
  // pdfjs.GlobalWorkerOptions.workerSrc, copy that line here instead of this one.
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const w: any = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = w.default;
  }
  // .slice(0) copies the bytes: pdf.js detaches the buffer it is given, and the
  // original is still needed to attach the lab PDF to the final report.
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
  let text = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    const rows: { y: number; items: { x: number; s: string }[] }[] = [];
    for (const it of content.items as any[]) {
      if (!("str" in it) || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5];
      const row = rows.find(r => Math.abs(r.y - y) < 3);
      if (row) row.items.push({ x, s: it.str }); else rows.push({ y, items: [{ x, s: it.str }] });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) text += r.items.sort((a, b) => a.x - b.x).map(i => i.s).join(" ") + "\n";
    text += "\n";
  }
  return parseLabText(text);
}
