export interface Hazard {
  id: string;
  location: string;
  component: string;
  substrate: string;
  status: "Pass" | "Fail";
  before: string | null; // data URL
  after: string | null; // data URL
  xrf?: string;
}

export interface DustWipe {
  id: string;
  sampleId: string;
  location: string;
  result: string;
  standard: string;
  status: "Pass" | "Fail";
}

export interface InspectorInfo {
  name: string;
  fullName: string;
  inspectorCert: string;
  assessorCert: string;
  department: string;
  street: string;
  cityStateZip: string;
  phone: string;
  poBox: string;
  poCity: string;
  office: string;
  fax: string;
}

export interface ReportData {
  ownerName: string;
  salutation: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  reportDate: string;
  clearanceDate: string;
  raCompany: string;
  raDate: string;
  soilCollected: boolean;
  coverPhoto: string | null;
  signature: string | null;
  hazards: Hazard[];
  dustWipes: DustWipe[];
  labPdf: ArrayBuffer | null;
  labPdfName: string;
  certFiles: { name: string; data: ArrayBuffer; type: string }[];
  inspector: InspectorInfo;
}

export const defaultInspector: InspectorInfo = {
  name: "Donta Anderson",
  fullName: "Donta K. Anderson",
  inspectorCert: "DI249483",
  assessorCert: "DR249483",
  department: "City of Monroe: Planning & Urban Development",
  street: "1401 Stubbs Avenue",
  cityStateZip: "Monroe, Louisiana 71201",
  phone: "318-329-2256",
  poBox: "P.O. Box 123",
  poCity: "Monroe, LA 71201-0123",
  office: "318-329-2256",
  fax: "318-329-4151",
};

export const uid = () => Math.random().toString(36).slice(2, 10);

export const newDustWipe = (n: number): DustWipe => ({
  id: uid(),
  sampleId: String(n),
  location: "",
  result: "< 2.0",
  standard: "5.0",
  status: "Pass",
});

/** Pass when the result is below the standard (a "<" result is always below). */
export function dustStatus(result: string, standard: string): "Pass" | "Fail" {
  const r = result.trim();
  if (r.startsWith("<")) return "Pass";
  const v = parseFloat(r.replace(/[^\d.]/g, ""));
  const s = parseFloat(standard.replace(/[^\d.]/g, ""));
  if (isNaN(v) || isNaN(s)) return "Pass";
  return v > s ? "Fail" : "Pass";
}

const WORDS = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen",
  "Nineteen", "Twenty",
];
export const numberWord = (n: number) => (n >= 0 && n <= 20 ? WORDS[n] : String(n));

/** "2026-09-17" -> "9/17/2026" */
export function fmtDate(iso: string): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
}
