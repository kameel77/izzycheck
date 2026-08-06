"use client";

import React from "react";
import { ProcessedMarkerItem } from "@/lib/damage/build-damage-presentation";

interface DamageMarkerTableProps {
  markers: ProcessedMarkerItem[];
}

export function DamageMarkerTable({ markers }: DamageMarkerTableProps) {
  if (markers.length === 0) {
    return (
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-950 text-xs text-slate-400 text-center">
        Brak markerów spełniających kryteria wybranego filtra.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
        Tabela Szczegółowa Markerów i Grup Części
      </h4>

      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800 uppercase text-[10px] tracking-wider">
            <tr>
              <th className="py-3 px-4">#</th>
              <th className="py-3 px-4">Źródło</th>
              <th className="py-3 px-4 font-mono">Kod Audatex</th>
              <th className="py-3 px-4">Polska Nazwa / Opis Strefy</th>
              <th className="py-3 px-4">Kategoria</th>
              <th className="py-3 px-4">Widoczność na Ujęciach</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-medium">
            {markers.map((m) => {
              const isNoLocation = m.viewVisibilityText === "Brak lokalizacji na makiecie";

              return (
                <tr key={m.id} className="hover:bg-slate-900/60 transition-colors">
                  <td className="py-3 px-4">
                    <span
                      style={{ backgroundColor: m.colorHex }}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-white text-[11px] font-black"
                    >
                      {m.markerIndex}
                    </span>
                  </td>

                  <td className="py-3 px-4">
                    <span className="rounded bg-slate-900 px-2 py-0.5 text-[11px] font-mono text-slate-300 border border-slate-800">
                      {m.sourceKind === "zone"
                        ? "Strefa Audatex"
                        : m.sourceKind === "group"
                        ? "Grupa części w kalkulacji"
                        : m.sourceKind === "glass_flag"
                        ? "Flaga szyby Audatex"
                        : "Flaga ogólna Audatex"}
                    </span>
                  </td>

                  <td className="py-3 px-4 font-mono text-slate-200 font-bold">
                    {m.sourceCode}
                  </td>

                  <td className="py-3 px-4 text-white">
                    {m.labelPl}
                  </td>

                  <td className="py-3 px-4">
                    <span
                      style={{ borderColor: `${m.colorHex}40`, backgroundColor: `${m.colorHex}15`, color: m.colorHex }}
                      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border"
                    >
                      {m.categoryLabelPl}
                      {m.subType === "glass" ? " (Szyba)" : m.subType === "lighting" ? " (Oświetlenie)" : ""}
                    </span>
                  </td>

                  <td className="py-3 px-4">
                    {isNoLocation ? (
                      <span className="text-slate-500 italic text-[11px]">
                        Poza tym ujęciem / grupa w kalkulacji
                      </span>
                    ) : (
                      <span className="text-emerald-400 font-semibold text-[11px]">
                        {m.viewVisibilityText}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
