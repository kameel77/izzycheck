"use client";

import React from "react";
import { ProcessedMarkerItem } from "@/lib/damage/build-damage-presentation";

/** Part groups from the Audatex calculation: one chip per group (dot in the category colour + name, no codes). */
export function DamageGroupChips({ groups }: { groups: ProcessedMarkerItem[] }) {
  if (groups.length === 0) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
        Zakres naprawy (grupy części w kalkulacji Audatex)
      </h4>
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <span
            key={g.id}
            className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950 px-3 py-1 text-xs text-slate-200"
          >
            <span style={{ backgroundColor: g.colorHex }} className="h-2 w-2 rounded-full shrink-0"></span>
            {g.titlePl}
          </span>
        ))}
      </div>
    </div>
  );
}

/** "Strefy uszkodzeń": dot in the category colour + plain-language description, ordered by zone code. */
export function DamageZoneList({
  zones,
  hasUndefinedZone,
}: {
  zones: ProcessedMarkerItem[];
  hasUndefinedZone: boolean;
}) {
  if (zones.length === 0 && !hasUndefinedZone) return null;
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Strefy uszkodzeń</h4>
      {zones.length > 0 && (
        <ul className="divide-y divide-slate-800/60 rounded-2xl border border-slate-800 bg-slate-950 px-4">
          {zones.map((m) => (
            <li key={m.id} className="flex items-start gap-3 py-2.5 text-xs">
              <span style={{ backgroundColor: m.colorHex }} className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"></span>
              <span className="text-white font-medium">
                {m.titlePl}
                {m.hintPl && <span className="block text-[11px] font-normal text-slate-500">{m.hintPl}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {hasUndefinedZone && (
        <p className="text-[11px] text-slate-500">Audatex wskazał także elementy bez przypisanej strefy.</p>
      )}
    </div>
  );
}
