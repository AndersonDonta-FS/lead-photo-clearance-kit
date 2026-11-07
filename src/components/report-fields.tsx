import { useRef, useState, type ReactNode } from "react";
import { Upload, ImagePlus, X, FileText, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function Field({ label, value, onChange, type = "text", placeholder = "" }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return <label className="grid gap-2 text-sm font-medium"><span>{label}</span><Input type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} /></label>;
}

export function SectionTitle({ number, title, children }: { number?: string; title: string; children?: ReactNode }) {
  return <div className="mb-6 flex items-start justify-between gap-3"><div className="flex items-center gap-3">{number && <span className="text-xs font-semibold text-primary">{number}</span>}<h2 className="text-lg font-semibold">{title}</h2></div>{children}</div>;
}

export async function readImage(file: File): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
  const image = new Image();
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = url; });
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Photo could not be processed.");
  ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", .9);
}

export function UploadField({ label, accept, name, photo, onFiles, onRemove, compact = false }: { label: string; accept: string; name?: string; photo?: string | null; onFiles: (files: File[]) => Promise<void>; onRemove?: () => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function load(files: File[]) { if (!files.length) return; setBusy(true); setError(""); try { await onFiles(files); } catch (e) { setError(e instanceof Error ? e.message : "This file could not be opened."); } finally { setBusy(false); } }
  return <div className="min-w-0"><input ref={input} type="file" aria-label={label} className="hidden" accept={accept} multiple={label === "Certifications"} onChange={e => { void load(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    <div className={`upload-zone relative ${compact ? "min-h-32" : "min-h-40"}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void load(Array.from(e.dataTransfer.files)); }}>
      {photo ? <><img src={photo} alt={label} className="h-44 w-full rounded object-contain" /><Button variant="secondary" size="icon" className="absolute right-2 top-2" title={`Remove ${label}`} aria-label={`Remove ${label}`} onClick={onRemove}><X /></Button><Button variant="ghost" size="sm" onClick={() => input.current?.click()}>Replace photo</Button></> : <Button variant="ghost" className="h-auto w-full flex-col gap-3 whitespace-normal py-6" disabled={busy} onClick={() => input.current?.click()}>{busy ? <LoaderCircle className="animate-spin" /> : accept.includes("image") ? <ImagePlus /> : name ? <FileText /> : <Upload />}<span>{name || label}</span><span className="text-xs font-normal text-muted-foreground">{accept.includes("image") ? "JPG or PNG" : "PDF document"}</span></Button>}
    </div>{error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
  </div>;
}