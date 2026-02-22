import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { Dropbox } from "dropbox";
import XLSX from "xlsx";

type CalcRequest = { inputs: Record<string, number> };

type CalcResponse = {
  outputs: Record<string, number>;
  meta: { cacheHit: boolean; calcMs: number };
};

const CACHE = new Map<string, { outputs: Record<string, number>; ts: number }>();

const OUTPUT_NAMES = [
  "Total_Equity_IRR",
  "Total_Equity_Multiple",
  "Investor_IRR",
  "Investor_Multiple",
  "Sponsor_IRR",
  "Sponsor_Multiple",
  "Investor_recovers_cash_in_year",
];

function findNamedRef(workbook: XLSX.WorkBook, name: string): string | null {
  const wbNames = workbook.Workbook?.Names || [];
  const hit = wbNames.find((n: any) => n.Name === name);
  return hit?.Ref || null;
}

function setNamedValue(workbook: XLSX.WorkBook, name: string, value: number) {
  const ref = findNamedRef(workbook, name);
  if (!ref) throw new Error(`Named range not found: ${name}`);

  const [sheetNameRaw, cellRaw] = ref.split("!");
  const sheetName = sheetNameRaw.replace(/'/g, "");
  const cell = cellRaw.replace(/\$/g, "");

  const ws = workbook.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet not found for named range ${name}: ${sheetName}`);

  ws[cell] = ws[cell] || { t: "n", v: 0 };
  ws[cell].t = "n";
  ws[cell].v = value;
}

function getNamedNumber(workbook: XLSX.WorkBook, name: string): number {
  const ref = findNamedRef(workbook, name);
  if (!ref) throw new Error(`Named range not found: ${name}`);

  const [sheetNameRaw, cellRaw] = ref.split("!");
  const sheetName = sheetNameRaw.replace(/'/g, "");
  const cell = cellRaw.replace(/\$/g, "");

  const ws = workbook.Sheets[sheetName];
  const v = ws?.[cell]?.v;

  const num = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(num)) throw new Error(`Output ${name} is not numeric (got: ${v})`);
  return num;
}

async function downloadTemplate(tempPath: string) {
  const token = process.env.DROPBOX_ACCESS_TOKEN;
  const tplPath = process.env.DROPBOX_TEMPLATE_PATH;

  if (!token) throw new Error("Missing DROPBOX_ACCESS_TOKEN");
  if (!tplPath) throw new Error("Missing DROPBOX_TEMPLATE_PATH");

  const dbx = new Dropbox({ accessToken: token });
  const dl: any = await dbx.filesDownload({ path: tplPath });

  const bin =
    (dl.result && (dl.result.fileBinary as any)) ||
    (dl.result && dl.result.fileBlob) ||
    dl.fileBinary;

  if (!bin) throw new Error("Could not read template binary from Dropbox response.");

  if (typeof bin === "string") {
    fs.writeFileSync(tempPath, bin, "binary");
  } else if (bin instanceof ArrayBuffer) {
    fs.writeFileSync(tempPath, Buffer.from(bin));
  } else if (bin.arrayBuffer) {
    const ab = await bin.arrayBuffer();
    fs.writeFileSync(tempPath, Buffer.from(ab));
  } else {
    fs.writeFileSync(tempPath, Buffer.from(bin));
  }
}

async function recalcWithLibreOffice(xlsxPath: string): Promise<string> {
  const lo = process.env.LIBREOFFICE_BIN || "libreoffice";
  const outdir = path.dirname(xlsxPath);
  const base = path.basename(xlsxPath, path.extname(xlsxPath));

  await new Promise<void>((resolve, reject) => {
    execFile(
      lo,
      ["--headless", "--nologo", "--nofirststartwizard", "--convert-to", "xlsx", xlsxPath, "--outdir", outdir],
      { timeout: 45_000 },
      (err, _stdout, stderr) => {
        if (err) return reject(new Error(`LibreOffice failed: ${stderr || err.message}`));
        resolve();
      }
    );
  });

  return path.join(outdir, `${base}.xlsx`);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<CalcResponse | { error: string }>) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const t0 = Date.now();
  try {
    const body = req.body as CalcRequest;
    if (!body?.inputs) return res.status(400).json({ error: "Missing inputs" });

    const cacheKey = JSON.stringify(body.inputs);
    const cached = CACHE.get(cacheKey);
    if (cached && Date.now() - cached.ts < 60_000) {
      return res.json({ outputs: cached.outputs, meta: { cacheHit: true, calcMs: Date.now() - t0 } });
    }

    const tempPath = path.join("/tmp", `model-${Date.now()}-${Math.random().toString(16).slice(2)}.xlsx`);

    await downloadTemplate(tempPath);

    const wb = XLSX.readFile(tempPath);
    for (const [name, value] of Object.entries(body.inputs)) {
      setNamedValue(wb, name, value);
    }
    XLSX.writeFile(wb, tempPath);

    const outPath = await recalcWithLibreOffice(tempPath);

    const wb2 = XLSX.readFile(outPath);
    const outputs: Record<string, number> = {};
    for (const outName of OUTPUT_NAMES) outputs[outName] = getNamedNumber(wb2, outName);

    CACHE.set(cacheKey, { outputs, ts: Date.now() });

    return res.json({ outputs, meta: { cacheHit: false, calcMs: Date.now() - t0 } });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}
