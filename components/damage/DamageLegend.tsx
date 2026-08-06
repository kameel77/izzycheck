"use client";

import React from "react";
import { DamageCategory, CATEGORY_DEFINITIONS } from "@/lib/damage/audatex-classification";

interface DamageLegendProps {
  categoryCounts: Record<DamageCategory, number>;
  selectedCategory: DamageCategory | "ALL";
  onSelectCategory: (cat: DamageCategory | "ALL") => void;
}

export function DamageLegend({
  categoryCounts,
  selectedCategory,
  onSelectCategory,
}: DamageLegendProps) {
  const totalCount = Object.values(categoryCounts).reduce((a, b) => a + b, 0);

  const filters: { id: DamageCategory | "ALL"; label: string; count: number; colorHex?: string }[] = [
    { id: "ALL", label: "Wszystkie", count: totalCount },
    { id: "BODY", label: CATEGORY_DEFINITIONS.BODY.labelPl, count: categoryCounts.BODY, colorHex: CATEGORY_DEFINITIONS.BODY.colorHex },
    { id: "GLASS_LIGHTING", label: CATEGORY_DEFINITIONS.GLASS_LIGHTING.labelPl, count: categoryCounts.GLASS_LIGHTING, colorHex: CATEGORY_DEFINITIONS.GLASS_LIGHTING.colorHex },
    { id: "MECHANICAL", label: CATEGORY_DEFINITIONS.MECHANICAL.labelPl, count: categoryCounts.MECHANICAL, colorHex: CATEGORY_DEFINITIONS.MECHANICAL.colorHex },
    { id: "UNDERBODY", label: CATEGORY_DEFINITIONS.UNDERBODY.labelPl, count: categoryCounts.UNDERBODY, colorHex: CATEGORY_DEFINITIONS.UNDERBODY.colorHex },
  ];

  return (
    <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800 pb-3">
        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
          Legenda & Filtry Markera Według Audatex
        </h4>
        <span className="text-[11px] text-slate-400">
          Wykrytych pozycji stref i grup: <strong className="text-white font-mono">{totalCount}</strong>
        </span>
      </div>

      {/* Category Filter Buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {filters.map((f) => {
          const isSelected = selectedCategory === f.id;
          return (
            <button
              key={f.id}
              onClick={() => onSelectCategory(f.id)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
                isSelected
                  ? "bg-slate-100 text-slate-950 border-white shadow-md font-bold"
                  : "bg-slate-950/70 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white"
              }`}
            >
              {f.colorHex && (
                <span
                  style={{ backgroundColor: f.colorHex }}
                  className="h-2.5 w-2.5 rounded-full"
                ></span>
              )}
              <span>{f.label}</span>
              <span className={`px-1.5 py-0.2 rounded-md text-[10px] font-mono ${isSelected ? "bg-slate-900 text-white" : "bg-slate-800 text-slate-400"}`}>
                {f.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Distinction notice for Glass vs Lighting in legend */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 text-[11px] text-slate-400 border-t border-slate-800/60">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rotate-45 bg-blue-500 rounded-sm shrink-0"></span>
          <span><strong>Szyba</strong>: Oszklenie nadwozia (przednia, tylna, boczne)</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rotate-45 bg-blue-500 rounded-sm shrink-0"></span>
          <span><strong>Oświetlenie</strong>: Grupa 006 (reflektory, lampy)</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="h-3 w-3 bg-red-500 rounded-sm shrink-0"></span>
          <span><strong>Nadwozie</strong>: Poszycie zewnętrzne / rama</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-purple-500 shrink-0"></span>
          <span><strong>Podwozie</strong>: Strefa 18 / płyta podłogowa</span>
        </div>
      </div>
    </div>
  );
}
