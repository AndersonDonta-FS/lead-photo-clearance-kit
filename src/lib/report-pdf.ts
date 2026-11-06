import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { ReportData } from "./report-types";
import { fmtDate, numberWord } from "./report-types";
import { GLOSSARY, RESOURCES } from "./report-glossary";

const W = 612;
const H = 792;
const ML = 72;
const MR = 72;
const TOP = H - 115;
const BOTTOM = 72;
const NAVY = rgb(0.13, 0.2, 0.45);
const BLACK = rgb(0, 0, 0);

/** Standard PDF fonts only cover WinAnsi; map look-alikes. */
const clean = (s: string) =>
  s
    .replace(/\u03bc/g, "\u00b5")
    .replace(/[\u2264]/g, "<=")
    .replace(/[\u2265]/g, ">=")
    .replace(/[^\x00-\xff\u2018\u2019\u201c\u201d\u2013\u2014\u2022\u2026]/g, "");

type Seg = { t: string; b?: boolean; u?: boolean };
/** "plain **bold** plain" -> segments */
const rich = (s: string): Seg[] =>
  s.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((p) => (p.startsWith("**") ? { t: p.slice(2, -2), b: true } : { t: p }));

async function fetchBytes(url: string) {
  const r = await fetch(url);
  return new Uint8Array(await r.arrayBuffer());
}

export async function buildReport(d: ReportData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const F = {
    r: await pdf.embedFont(StandardFonts.Helvetica),
    b: await pdf.embedFont(StandardFonts.HelveticaBold),
    bi: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const logo = await pdf.embedPng(await fetchBytes("/letterhead/logo.png"));
  const wm = await pdf.embedPng(await fetchBytes("/letterhead/watermark.png"));
  const imgCache = new Map<string, PDFImage>();
  const img = async (dataUrl: string) => {
    if (imgCache.has(dataUrl)) return imgCache.get(dataUrl)!;
    const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
    const im = dataUrl.startsWith("data:image/png") ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    imgCache.set(dataUrl, im);
    return im;
  };

  const I = d.inspector;
  const addr2 = `${d.city}, ${d.state} ${d.zip}`.trim();
  const clearDate = fmtDate(d.clearanceDate);
  const repDate = fmtDate(d.reportDate);
  const raDate = fmtDate(d.raDate);

  // ---------- page helpers
  const newPage = () => {
    const p = pdf.addPage([W, H]);
    p.drawImage(wm, { x: 0, y: 0, width: W, height: H });
    const lw = 165;
    p.drawImage(logo, { x: 40, y: H - 62, width: lw, height: (lw * logo.height) / logo.width });
    const lines = [I.poBox, I.poCity, `office: ${I.office}`, `fax: ${I.fax}`];
    lines.forEach((l, i) => {
      const s = 7.5;
      const t = clean(l);
      p.drawText(t, { x: W - 40 - F.bi.widthOfTextAtSize(t, s), y: H - 36 - i * 9, size: s, font: F.bi, color: NAVY });
    });
    return p;
  };
  const center = (p: PDFPage, t: string, y: number, size: number, font: PDFFont = F.r, color = BLACK) => {
    const s = clean(t);
    p.drawText(s, { x: (W - font.widthOfTextAtSize(s, size)) / 2, y, size, font, color });
  };
  const fit = (im: PDFImage, bw: number, bh: number) => {
    const sc = Math.min(bw / im.width, bh / im.height);
    return { w: im.width * sc, h: im.height * sc };
  };

  // ---------- flowing text writer
  let page: PDFPage;
  let y = TOP;
  const ensure = (h: number) => {
    if (y - h < BOTTOM) {
      page = newPage();
      y = TOP;
    }
  };
  const para = (text: string, opts: { size?: number; gap?: number; indent?: number; justify?: boolean } = {}) => {
    const size = opts.size ?? 11;
    const lh = size * 1.32;
    const x0 = ML + (opts.indent ?? 0);
    const maxW = W - MR - x0;
    const words: Seg[] = [];
    for (const seg of rich(clean(text))) for (const w of seg.t.split(/(\s+)/)) if (w) words.push({ t: w, b: seg.b });
    let line: Seg[] = [];
    let lw = 0;
    const flush = (last: boolean) => {
      while (line.length && /^\s+$/.test(line[line.length - 1].t)) line.pop();
      ensure(lh);
      const total = line.reduce((a, s) => a + (s.b ? F.b : F.r).widthOfTextAtSize(s.t, size), 0);
      const spaces = line.filter((s) => /^\s+$/.test(s.t)).length;
      const extra = opts.justify && !last && spaces ? (maxW - total) / spaces : 0;
      let x = x0;
      for (const s of line) {
        const f = s.b ? F.b : F.r;
        if (/^\s+$/.test(s.t)) {
          x += f.widthOfTextAtSize(" ", size) + extra;
          continue;
        }
        page.drawText(s.t, { x, y: y - size, size, font: f, color: BLACK });
        x += f.widthOfTextAtSize(s.t, size);
      }
      y -= lh;
      line = [];
      lw = 0;
    };
    for (const w of words) {
      const ww = (w.b ? F.b : F.r).widthOfTextAtSize(/^\s+$/.test(w.t) ? " " : w.t, size);
      if (lw + ww > maxW && line.length && !/^\s+$/.test(w.t)) flush(false);
      if (!line.length && /^\s+$/.test(w.t)) continue;
      line.push(/^\s+$/.test(w.t) ? { t: " ", b: w.b } : w);
      lw += ww;
    }
    if (line.length) flush(true);
    y -= opts.gap ?? 10;
  };
  const heading = (t: string) => {
    ensure(40);
    const size = 11;
    const s = clean(t);
    page.drawText(s, { x: ML, y: y - size, size, font: F.b });
    page.drawLine({ start: { x: ML, y: y - size - 2 }, end: { x: ML + F.b.widthOfTextAtSize(s, size), y: y - size - 2 }, thickness: 0.8 });
    y -= size + 10;
  };
  const bullet = (t: string) => {
    ensure(16);
    page.drawText("\u2022", { x: ML + 14, y: y - 11, size: 11, font: F.r });
    para(t, { indent: 30, gap: 2 });
  };
  const signature = () => {
    para("Sincerely,", { gap: 6 });
    if (d.signature) {
      ensure(70);
      // signature image is drawn later per page, so draw directly now
      void 0;
    }
  };
  const sigBlock = async () => {
    ensure(110);
    para("Sincerely,", { gap: 4 });
    if (d.signature) {
      const im = await img(d.signature);
      const { w, h } = fit(im, 160, 50);
      page.drawImage(im, { x: ML, y: y - h, width: w, height: h });
      y -= h + 6;
    } else y -= 30;
    para(I.fullName, { gap: 0 });
    para(`Lead Risk Assessor, (LDEQ# ${I.assessorCert})`, { gap: 0 });
    para("City Of Monroe: Planning & Urban Development", { gap: 0 });
  };
  void signature;

  const divider = (title: string[]) => {
    const p = newPage();
    let yy = H / 2 + (title.length * 34) / 2;
    for (const t of title) {
      center(p, t, yy, t ? 30 : 0, F.b);
      yy -= 42;
    }
    return p;
  };

  // ---------- 1. Cover
  {
    const p = newPage();
    center(p, "Lead Clearance Report", H - 110, 18, F.b);
    let yy = H - 130;
    if (d.coverPhoto) {
      const im = await img(d.coverPhoto);
      const { w, h } = fit(im, 340, 240);
      p.drawImage(im, { x: (W - w) / 2, y: yy - h, width: w, height: h });
      yy -= h;
    } else yy -= 240;
    yy -= 60;
    const blk: [string, boolean][] = [
      ["Performed at:", true],
      [d.street, true],
      [addr2, true],
      ["", false],
      ["Prepared By:", true],
      [I.name, true],
      [I.department, true],
      [`Lead Inspector Certification: #${I.inspectorCert}`, true],
      [`Risk Assessor Certification: #${I.assessorCert}`, true],
      [I.street, true],
      [I.cityStateZip, true],
      [I.phone, true],
      ["", false],
      ["Report Date:", true],
      [repDate, true],
    ];
    for (const [t] of blk) {
      if (t) center(p, t, yy, 10, F.b);
      yy -= 13;
    }
  }

  // ---------- 2. Letter
  page = newPage();
  center(page, "Letter to the Owner", H - 110, 14);
  y = H - 150;
  para(repDate, { gap: 0 });
  para(d.ownerName, { gap: 0 });
  para(d.street, { gap: 0 });
  para(addr2, { gap: 36 });
  const last = d.ownerName.trim().split(/\s+/).slice(-1)[0] ?? "";
  para(`Dear ${d.salutation} ${last},`, { gap: 18 });
  para(
    "A Lead Clearance Inspection was performed at the residence listed above to confirm that the identified lead hazards have been addressed and the hazards at the property have been sufficiently mitigated.",
    { gap: 14 },
  );
  para(
    `Lead Risk Hazards were previously identified in the Risk Assessment report. ${I.name} (Lead Risk Assessor - ${I.assessorCert}), conducted a visual inspection to confirm the completion of the work in accordance with HUD Chapter 15, Lead Clearance Standards.`,
    { gap: 14 },
  );
  para("Please refer to the dust wipe results for the location of any hazards found.", { gap: 30 });
  await sigBlock();

  // ---------- 3. TOC (filled after body)
  const tocPage = newPage();

  // ---------- 4+. Body
  const sections: [string, number][] = [];
  const mark = (t: string) => sections.push([t, pdf.getPageCount()]);
  page = newPage();
  y = TOP;
  const allPass = d.hazards.every((h) => h.status === "Pass") && d.dustWipes.every((w) => w.status === "Pass");
  const nH = d.hazards.length;
  const nW = d.dustWipes.length;

  mark("Executive Summary");
  heading("Executive Summary");
  para(`The City of Monroe presents this report on the Lead Clearance Inspection conducted at ${d.street}.`, { gap: 12 });
  para(
    allPass
      ? `Based on the results of visual inspection and testing, it was found that lead hazards were not present on the subject property as of ${clearDate}. The details of the field assessment report including all data collection are attached in **Appendix B \u2013 Clearance Data Report** of this report. All identified lead-based paint hazards should always be properly addressed by professionally certified lead contractors and workers.`
      : `Based on the results of visual inspection and testing, it was found that lead hazards remained present on the subject property as of ${clearDate}. The details of the field assessment report including all data collection are attached in **Appendix B \u2013 Clearance Data Report** of this report. All identified lead-based paint hazards should always be properly addressed by professionally certified lead contractors and workers.`,
    { gap: 20 },
  );
  mark("Visual Clearance Inspection");
  heading("Visual Clearance Inspection");
  para(
    `${numberWord(nH)} (${nH}) risk hazards were identified in the risk assessment report completed by ${d.raCompany}; report dated ${raDate}. The risk hazards that were identified are summarized in **Appendix B \u2013 Clearance Data Report**. ${
      d.hazards.every((h) => h.status === "Pass")
        ? "Based on our inspection no additional actions are necessary to address the risks previously identified at this property."
        : "Based on our inspection, one or more previously identified risks have not been adequately addressed and require additional action."
    }`,
    { gap: 20 },
  );
  mark("Clearance Dust Sampling");
  heading("Clearance Dust Sampling");
  para(
    `In addition to the visual inspection, lead dust samples were collected as part of the clearance process to ensure that mitigation efforts did not generate dust or additional lead hazards inside of the home. A total of ${nW} dust wipe samples were collected in effort to help determine the levels of lead-containing dust on the floors. These samples were collected from areas most likely to be lead-contaminated if lead-in-dust is present based on locations of abatement activities. These samples were collected in accordance with the requirements of ASTM Standard E-1728, Standard Practice for Field Collection of Settled Dust Samples Using Wipe Sampling Methods for Lead Determination by Atomic Spectrometry Techniques.`,
    { gap: 4 },
  );
  para("EPA and State of Louisiana regulations define the following as hazardous levels for lead dust in residences:", { gap: 6 });
  bullet("**Floors:** >5 \u00b5g /ft\u00b2 (micrograms per square foot)");
  bullet("**Interior window sills:** >40 \u00b5g /ft\u00b2");
  bullet("**Interior window wells:** >100 \u00b5g /ft\u00b2");
  y -= 8;
  const failW = d.dustWipes.filter((w) => w.status === "Fail").length;
  para(
    `${failW === 0 ? "**NONE**" : `**${numberWord(failW).toUpperCase()} (${failW})**`} of the samples ${failW === 1 ? "was" : "were"} above the threshold limits. Please refer to Appendix A \u2013 Dust Sample Analytical Data for the detailed analytical reports.`,
    { gap: 20 },
  );
  mark("Clearance Soil Sampling");
  heading("Clearance Soil Sampling");
  para(
    d.soilCollected
      ? "Soil samples were collected at this residence in accordance with the regulatory requirements. Please refer to Appendix A for the analytical results."
      : "No soil samples were collected at this residence as no soil hazards were present at the time of the clearance. This is in accordance with the regulatory requirements.",
    { gap: 20 },
  );
  mark("Conclusions & Recommendations");
  heading("Conclusions & Recommendations");
  para(
    allPass
      ? `The visual inspection and sample results have not identified lead-based paint (LBP) hazards as identified by the Environmental Protection Agency (EPA) and Louisiana Department of Environmental Quality (LDEQ). This property passes clearance as of ${clearDate}.`
      : `The visual inspection and/or sample results have identified lead-based paint (LBP) hazards as identified by the Environmental Protection Agency (EPA) and Louisiana Department of Environmental Quality (LDEQ). This property does not pass clearance as of ${clearDate}. The identified hazards must be addressed and the property re-cleared.`,
    { gap: 20 },
  );
  mark("Legal Disclaimer for Clearance Reports");
  heading("Legal Disclaimer for Clearance Reports");
  para(
    "Staff of the **City of Monroe Planning & Urban Development Department** have performed the clearance tasks requested in a thorough and professional manner, consistent with commonly accepted industry standards and utilizing the best available technology as of the date of the assessment. The **City of Monroe** cannot guarantee and does not warrant that this assessment has identified every adverse environmental factor or condition affecting the subject property on the date of the assessment. Furthermore, the City does not warrant that this assessment will satisfy the full dictates of, or provide a legal defense for, any environmental laws or regulations. It remains the sole responsibility of the property owner/client to understand and comply with all applicable local, state, and federal laws, including the EPA\u2019s **Renovation, Repair, and Painting (RRP) Rule.**",
    { gap: 4, justify: true },
  );
  para(
    "The findings and conclusions presented herein are for the primary benefit of the client and the City\u2019s internal records. These results and opinions are based strictly on the conditions observed at the property on the specific date of the assessment and are valid only for that timeframe. The **City of Monroe** assumes no obligation to notify the client of any changes in real or potential lead hazards that may arise or be brought to the City\u2019s attention after the assessment date. Additional conditions and limitations regarding this assessment are subject to the general terms and guidelines of the Planning & Urban Development Department.",
    { gap: 16, justify: true },
  );
  await sigBlock();

  // TOC fill
  {
    center(tocPage, "Table of Contents", H - 130, 28, F.b);
    let yy = H - 200;
    for (const [t, n] of sections) {
      const s = clean(t);
      const num = String(n);
      tocPage.drawText(s, { x: ML, y: yy, size: 11, font: F.r });
      tocPage.drawText(num, { x: W - MR - F.r.widthOfTextAtSize(num, 11), y: yy, size: 11, font: F.r });
      const dotsStart = ML + F.r.widthOfTextAtSize(s, 11) + 4;
      const dotsEnd = W - MR - F.r.widthOfTextAtSize(num, 11) - 4;
      const dw = F.r.widthOfTextAtSize(".", 11);
      tocPage.drawText(".".repeat(Math.max(0, Math.floor((dotsEnd - dotsStart) / dw))), { x: dotsStart, y: yy, size: 11, font: F.r });
      yy -= 44;
    }
  }

  // ---------- Appendices list
  {
    const p = newPage();
    p.drawText("APPENDICES", { x: ML, y: H - 150, size: 28, font: F.b });
    const items = [
      "Appendix A \u2013 Dust Sample Analytical Data",
      "Appendix B- Clearance Data Report",
      "Appendix C- Certifications",
      "Appendix D- LEAD SPEAK: A Brief Glossary",
      "Appendix E- Additional Resources",
    ];
    items.forEach((t, i) => p.drawText(clean(t), { x: ML, y: H - 250 - i * 60, size: 13, font: F.r }));
  }

  // embeds an external PDF / image as letterhead pages
  const embedPages = async (data: ArrayBuffer) => {
    const src = await PDFDocument.load(data, { ignoreEncryption: true });
    const embedded = await pdf.embedPages(src.getPages());
    for (const ep of embedded) {
      const p = newPage();
      const sc = Math.min((W - 80) / ep.width, (H - 150) / ep.height);
      const w = ep.width * sc;
      const h = ep.height * sc;
      p.drawRectangle({ x: (W - w) / 2, y: 50 + (H - 150 - h) / 2, width: w, height: h, color: rgb(1, 1, 1) });
      p.drawPage(ep, { x: (W - w) / 2, y: 50 + (H - 150 - h) / 2, width: w, height: h });
    }
  };
  const embedImagePage = async (dataUrl: string) => {
    const p = newPage();
    const im = await img(dataUrl);
    const { w, h } = fit(im, W - 80, H - 150);
    p.drawImage(im, { x: (W - w) / 2, y: 50 + (H - 150 - h) / 2, width: w, height: h });
  };

  // ---------- Appendix A
  divider(["Appendix A", "", "Dust Sample", "Analytical Data"]);
  if (d.labPdf) await embedPages(d.labPdf);

  // ---------- Appendix B
  divider(["Appendix B", "", "Clearance Data", "Report"]);
  for (let i = 0; i < d.hazards.length; i++) {
    const hz = d.hazards[i];
    const p = newPage();
    let yy = H - 140;
    if (i === 0) {
      center(p, "VISUAL INSPECTION", yy, 20, F.b);
      center(p, "Lead Based Paint Affected Areas", yy - 26, 10, F.b);
    }
    yy = H - 205;
    const cols = [ML + 10, ML + 140, ML + 260, ML + 370, W - MR - 10];
    const heads = ["Location", "Component", "Substrate", "Pass/Fail"];
    const vals = [hz.location, hz.component, hz.substrate, hz.status];
    heads.forEach((t, k) => {
      const cx = (cols[k] + cols[k + 1]) / 2;
      p.drawText(t, { x: cx - F.b.widthOfTextAtSize(t, 10) / 2, y: yy, size: 10, font: F.b });
    });
    p.drawRectangle({ x: cols[0], y: yy - 18, width: cols[4] - cols[0], height: 14, borderWidth: 1, borderColor: BLACK });
    vals.forEach((t, k) => {
      const s = clean(t);
      const f = k === 1 ? F.r : F.b;
      const cx = (cols[k] + cols[k + 1]) / 2;
      if (k > 0) p.drawLine({ start: { x: cols[k], y: yy - 18 }, end: { x: cols[k], y: yy - 4 }, thickness: 1 });
      p.drawText(s, { x: cx - f.widthOfTextAtSize(s, 9) / 2, y: yy - 14, size: 9, font: f, color: k === 3 && hz.status === "Fail" ? rgb(0.75, 0.1, 0.1) : BLACK });
    });
    const boxW = 215;
    const boxH = 300;
    const by = yy - 50 - boxH;
    for (const [k, src, label] of [
      [0, hz.before, "BEFORE"],
      [1, hz.after, "AFTER"],
    ] as const) {
      const bx = k === 0 ? ML + 10 : W - MR - 10 - boxW;
      if (src) {
        const im = await img(src);
        const { w, h } = fit(im, boxW, boxH);
        p.drawImage(im, { x: bx + (boxW - w) / 2, y: by + (boxH - h) / 2, width: w, height: h });
      } else {
        p.drawRectangle({ x: bx, y: by, width: boxW, height: boxH, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1, borderDashArray: [4, 4] });
      }
      const lw = F.r.widthOfTextAtSize(label, 10);
      if (k === 0) p.drawText(label, { x: bx - 6, y: by + boxH / 2 - lw / 2, size: 10, font: F.r, rotate: degrees(90) });
      else p.drawText(label, { x: bx + boxW + 6, y: by + boxH / 2 + lw / 2, size: 10, font: F.r, rotate: degrees(-90) });
    }
  }

  // dust wipe results
  {
    const p = newPage();
    center(p, "DUST WIPES", H - 140, 20, F.b);
    center(p, "Results", H - 162, 10, F.b);
    const cols = [ML, ML + 70, ML + 200, ML + 280, ML + 390, W - MR];
    let yy = H - 210;
    const heads = [["Client Sample", "ID"], ["Location"], ["Result", "(\u00b5g/ft\u00b2)"], ["Clearance Standard", "(\u00b5g/ft\u00b2)"], ["Status"]];
    heads.forEach((ls, k) => {
      const cx = (cols[k] + cols[k + 1]) / 2;
      ls.forEach((t, j) => {
        const s = clean(t);
        p.drawText(s, { x: cx - F.b.widthOfTextAtSize(s, 9) / 2, y: yy - j * 11 - (ls.length === 1 ? 5 : 0), size: 9, font: F.b });
      });
    });
    yy -= 40;
    for (const w of d.dustWipes) {
      const vals = [w.sampleId, w.location, w.result, w.standard, w.status];
      vals.forEach((t, k) => {
        const s = clean(t);
        const cx = (cols[k] + cols[k + 1]) / 2;
        // wrap long locations
        const words = s.split(" ");
        const lines: string[] = [];
        let cur = "";
        for (const wd of words) {
          const nx = cur ? cur + " " + wd : wd;
          if (F.r.widthOfTextAtSize(nx, 10) > cols[k + 1] - cols[k] - 6 && cur) {
            lines.push(cur);
            cur = wd;
          } else cur = nx;
        }
        lines.push(cur);
        lines.forEach((l, j) =>
          p.drawText(l, {
            x: cx - F.r.widthOfTextAtSize(l, 10) / 2,
            y: yy - j * 12 + (lines.length - 1) * 6,
            size: 10,
            font: F.r,
            color: k === 4 && w.status === "Fail" ? rgb(0.75, 0.1, 0.1) : BLACK,
          }),
        );
      });
      yy -= 36;
      if (yy < BOTTOM) break;
    }
  }

  // ---------- Appendix C
  divider(["Appendix C", "Certifications"]);
  for (const f of d.certFiles) {
    if (f.type === "application/pdf") await embedPages(f.data);
    else {
      const blob = new Blob([f.data], { type: f.type });
      const url: string = await new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.readAsDataURL(blob);
      });
      await embedImagePage(url);
    }
  }

  // ---------- Appendix D
  divider(["Appendix D", "", "LEAD SPEAK:", "A Brief Glossary"]);
  page = newPage();
  y = TOP;
  for (const [term, def] of GLOSSARY) para(`**${term}:** ${def}`, { size: 10, gap: 10, justify: true });

  // ---------- Appendix E
  divider(["Appendix E", "", "Additional", "Resources"]);
  {
    const p = newPage();
    center(p, "ADDITIONAL RESOURCES", H - 160, 18, F.b);
    let yy = H - 230;
    for (const [a, b] of RESOURCES) {
      p.drawText("\u2022", { x: 170, y: yy, size: 12, font: F.r });
      p.drawText(clean(a), { x: 188, y: yy, size: 12, font: F.r });
      p.drawText(clean(b), { x: 188, y: yy - 16, size: 12, font: F.r });
      yy -= 64;
    }
  }

  // page numbers
  pdf.getPages().forEach((p, i) => {
    const s = String(i + 1);
    p.drawText(s, { x: (W - F.r.widthOfTextAtSize(s, 9)) / 2, y: 30, size: 9, font: F.r });
  });

  pdf.setTitle(`Lead Clearance Report - ${d.street}`);
  pdf.setAuthor(I.fullName);
  return pdf.save();
}
