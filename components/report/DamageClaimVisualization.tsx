"use client";

import React, { useState } from "react";
import { DamageCategory } from "@/lib/damage/audatex-classification";
import { buildFallbackDamageAssessment } from "@/lib/damage/normalize-damage-assessment";
import { buildDamagePresentation } from "@/lib/damage/build-damage-presentation";
import { VehicleDamageViews } from "@/components/damage/VehicleDamageViews";
import { DamageLegend } from "@/components/damage/DamageLegend";
import { DamageZoneList, DamageGroupChips } from "@/components/damage/DamageZoneList";

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
  bodyType?: string;
}

export function DamageClaimVisualization({
  claim,
  vehicleMakeModel,
  bodyType,
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
    selectedCategory,
    bodyType
  );

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

      {presentation.flagsText && (
        <p className="text-[11px] text-slate-400">{presentation.flagsText}</p>
      )}

      <DamageGroupChips groups={presentation.groupChips} />

      {/* Realistic / Schematic Stage Views */}
      <VehicleDamageViews
        template={presentation.template}
        markers={presentation.markers}
        hasUnderbodyView={presentation.hasUnderbodyView}
      />

      {/* Zone list (part groups are shown as chips above the maps) */}
      <DamageZoneList zones={presentation.zoneList} hasUndefinedZone={presentation.hasUndefinedZone} />
    </div>
  );
}
