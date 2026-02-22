import { useEffect, useMemo, useState } from "react";

const pct = (x: number | null) => (x == null || !isFinite(x) ? "—" : (x * 100).toFixed(2) + "%");
const mult = (x: number | null) => (x == null || !isFinite(x) ? "—" : x.toFixed(2) + "x");
const yr = (x: number | null) => (x == null || !isFinite(x) ? "—" : String(Math.round(x)));

export default function Home() {
  const [systemRating, setSystemRating] = useState(750);
  const [costPerWatt, setCostPerWatt] = useState(1.85);
  const [production, setProduction] = useState(1200000);

  const [ppaRate, setPpaRate] = useState(0.085);
  const [escalation, setEscalation] = useState(0.025);
  const [debtTerm, setDebtTerm] = useState(15);

  const [out, setOut] = useState<Record<string, number> | null>(null);
  const [status, setStatus] = useState("Ready");

  const payload = useMemo(
    () => ({
      inputs: {
        System_rating: systemRating,
        Cost_per_watt: costPerWatt,
        Estimated_Solar_Production__kWhrs: production,
        PPA_rate_in_Year_1: ppaRate,
        PPA_rate_escalation: escalation,
        Bank_debt_term: debtTerm,
      },
    }),
    [systemRating, costPerWatt, production, ppaRate, escalation, debtTerm]
  );

  useEffect(() => {
    const id = setTimeout(async () => {
      try {
        setStatus("Calculating…");
        const r = await fetch("/api/calc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Error");
        setOut(j.outputs);
        setStatus(j.meta.cacheHit ? "Updated (cache)" : "Updated");
      } catch (e: any) {
        setStatus(e.message || "Error");
      }
    }, 250);
    return () => clearTimeout(id);
  }, [payload]);

  return (
    <div style={{ fontFamily: "system-ui", maxWidth: 980, margin: "40px auto", padding: 16 }}>
      <h1>Solar Project IRR Sensitivity</h1>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
          <h2>Project Inputs</h2>

          <label>System rating</label>
          <input style={{ width: "100%" }} type="number" value={systemRating} onChange={(e) => setSystemRating(Number(e.target.value))} />

          <label style={{ display: "block", marginTop: 10 }}>Cost per watt</label>
          <input style={{ width: "100%" }} type="number" step="0.01" value={costPerWatt} onChange={(e) => setCostPerWatt(Number(e.target.value))} />

          <label style={{ display: "block", marginTop: 10 }}>Estimated Solar Production (kWh/yr)</label>
          <input style={{ width: "100%" }} type="number" value={production} onChange={(e) => setProduction(Number(e.target.value))} />
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
          <h2>Assumptions</h2>

          <div style={{ marginTop: 8 }}>
            <div>PPA rate in Year 1: {(ppaRate * 100).toFixed(2)}%</div>
            <input style={{ width: "100%" }} type="range" min={0.04} max={0.16} step={0.0005} value={ppaRate} onChange={(e) => setPpaRate(Number(e.target.value))} />
          </div>

          <div style={{ marginTop: 18 }}>
            <div>PPA escalation: {(escalation * 100).toFixed(2)}%</div>
            <input style={{ width: "100%" }} type="range" min={0} max={0.08} step={0.0005} value={escalation} onChange={(e) => setEscalation(Number(e.target.value))} />
          </div>

          <div style={{ marginTop: 18 }}>
            <div>Bank debt term: {debtTerm} years</div>
            <input style={{ width: "100%" }} type="range" min={0} max={25} step={1} value={debtTerm} onChange={(e) => setDebtTerm(Number(e.target.value))} />
          </div>

          <div style={{ marginTop: 12, fontSize: 12, color: "#555" }}>{status}</div>
        </div>
      </div>

      <div style={{ marginTop: 16, border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
        <h2>Outputs</h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          <div style={{ border: "1px solid #f0f0f0", borderRadius: 10, padding: 12 }}>
            <b>Total Equity</b>
            <div>IRR: {pct(out?.Total_Equity_IRR ?? null)}</div>
            <div>Multiple: {mult(out?.Total_Equity_Multiple ?? null)}</div>
          </div>

          <div style={{ border: "1px solid #f0f0f0", borderRadius: 10, padding: 12 }}>
            <b>Investor</b>
            <div>IRR: {pct(out?.Investor_IRR ?? null)}</div>
            <div>Multiple: {mult(out?.Investor_Multiple ?? null)}</div>
            <div>Cash recovery year: {yr(out?.Investor_recovers_cash_in_year ?? null)}</div>
          </div>

          <div style={{ border: "1px solid #f0f0f0", borderRadius: 10, padding: 12 }}>
            <b>Sponsor</b>
            <div>IRR: {pct(out?.Sponsor_IRR ?? null)}</div>
            <div>Multiple: {mult(out?.Sponsor_Multiple ?? null)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}