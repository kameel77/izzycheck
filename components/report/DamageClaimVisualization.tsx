"use client";

import React, { useState } from "react";
import { DamageCategory } from "@/lib/damage/audatex-classification";
import { buildFallbackDamageAssessment } from "@/lib/damage/normalize-damage-assessment";
import { buildDamagePresentation } from "@/lib/damage/build-damage-presentation";
import { VehicleDamageViews } from "@/components/damage/VehicleDamageViews";
import { DamageLegend } from "@/components/damage/DamageLegend";
import { DamageMarkerTable } from "@/components/damage/DamageMarkerTable";

interface DamageClaimVisualizationProps {
  claim: {
    id?: string;
    claimId: string;
    makeModel?: string;
    damageZones?: string;
    significantParts?: string;
    damageAssessmentJson?: string | null;
  };
  vehicleMakeModel?: string;
}

export function DamageClaimVisualization({
  claim,
  vehicleMakeModel,
}: DamageClaimVisualizationProps) {
  const [selectedCategory, setSelectedCategory] = useState<DamageCategory | "ALL">("ALL");

  // Parse or reconstruct damageAssessment
  let assessment = claim.damageAssessmentJson
    ? JSON.parse(claim.damageAssessmentJson)
    : undefined;

  // Robust fallback for historic reports without damageAssessmentJson
  if (!assessment) {
    const rawZones: string[] = claim.damageZones ? JSON.parse(claim.damageZones) : [];
    const rawParts: string[] = claim.significantParts ? JSON.parse(claim.significantParts) : [];

    assessment = buildFallbackDamageAssessment(rawZones, rawParts);
  }

  const makeModel = claim.makeModel || vehicleMakeModel || "";
  const presentation = buildDamagePresentation(
    claim.claimId,
    assessment,
    makeModel,
    selectedCategory
  );

  const hasUnpositionedGroups = presentation.markers.some((m) => m.viewVisibilityText === "Brak lokalizacji na makiecie");

  return (
    <div className="space-y-6 pt-4 border-t border-slate-800/80">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-red-500"></span>
          Mapa szkody według Audatex
        </h3>
        <span className="text-xs text-slate-400 font-mono">
          Makieta: {presentation.template.labelPl}
        </span>
      </div>

      {/* Legend & Filter Bar */}
      <DamageLegend
        categoryCounts={presentation.categoryCounts}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
      />

      {/* Notice if Audatex returned no zone locator for some markers */}
      {hasUnpositionedGroups && (
        <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-950/20 text-xs text-amber-300">
          <p className="font-semibold">Ograniczenie danych Audatex:</p>
          <p className="text-[11px] text-amber-200/80 pt-0.5">
            Dla niektórych grup części lub flag kalkulacji Audatex nie zwrócił dokładnej strefy liczbowej (01-27) do naniesienia na makiecie 3D. Pozycje te pozostają widoczne w poniższej tabeli szczegółowej.
          </p>
        </div>
      )}

      {/* SVG Perspectives */}
      <VehicleDamageViews
        bodyType={presentation.template.bodyType}
        labelPl={presentation.template.labelPl}
        isGeneric={presentation.template.isGeneric}
        markers={presentation.markers}
        hasUnderbodyView={presentation.hasUnderbodyView}
      />

      {/* Markers & Part Groups Table */}
      <DamageMarkerTable markers={presentation.markers} />
    </div>
  );
}
