"use client";

import React from "react";
import { DamageCategory, CATEGORY_DEFINITIONS, CATEGORY_PRIORITY_ORDER } from "@/lib/damage/audatex-classification";

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

  // Only categories that are actually present (zone 00 is not counted).
  const filters: { id: DamageCategory | "ALL"; label: string; count: number; colorHex?: string }[] = [
    { id: "ALL", label: "Wszystkie", count: totalCount },
    ...CATEGORY_PRIORITY_ORDER.filter((cat) => categoryCounts[cat] > 0).map((cat) => ({
      id: cat,
      label: CATEGORY_DEFINITIONS[cat].labelPl,
      count: categoryCounts[cat],
      colorHex: CATEGORY_DEFINITIONS[cat].colorHex,
    })),
  ];

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
          Legenda & Filtry Markera Według Audatex
        </h4>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          Wykryte strefy i grupy: <strong className="text-slate-900 dark:text-white font-mono">{totalCount}</strong>
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
                  ? "bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-950 dark:border-white shadow-md font-bold"
                  : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 hover:text-slate-900 dark:bg-slate-950/70 dark:text-slate-300 dark:border-slate-800 dark:hover:bg-slate-800 dark:hover:text-white"
              }`}
            >
              {f.colorHex && (
                <span
                  style={{ backgroundColor: f.colorHex }}
                  className="h-2.5 w-2.5 rounded-full"
                ></span>
              )}
              <span>{f.label}</span>
              <span className={`px-1.5 py-0.2 rounded-md text-[10px] font-mono ${isSelected ? "bg-white/20 text-white dark:bg-slate-900 dark:text-white" : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-400"}`}>
                {f.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
