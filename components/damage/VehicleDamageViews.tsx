"use client";

import React, { useState, useEffect } from "react";
import { ProcessedMarkerItem, PHOTO_1_CAPTION, PHOTO_2_CAPTION } from "@/lib/damage/build-damage-presentation";
import {
  VehicleBodyType,
  VehicleTemplateDefinition,
  VEHICLE_TEMPLATES,
  UNDERBODY_IMAGE_WEBP,
  UNDERBODY_VIEWBOX_H,
  UNDERBODY_VIEWBOX_W,
} from "@/lib/damage/vehicle-templates";

export type StageMode = "standard" | "contrast";

interface VehicleDamageViewsProps {
  template?: VehicleTemplateDefinition;
  bodyType?: VehicleBodyType;
  labelPl?: string;
  isGeneric?: boolean;
  markers: ProcessedMarkerItem[];
  hasUnderbodyView: boolean;
}

export function VehicleDamageViews({
  template,
  bodyType = template?.bodyType || "generic-passenger",
  labelPl = template?.labelPl || "Pojazd osobowy",
  isGeneric = template?.isGeneric ?? true,
  markers,
  hasUnderbodyView,
}: VehicleDamageViewsProps) {
  const [stageMode, setStageMode] = useState<StageMode>("standard");
  const [underbodyImageFailed, setUnderbodyImageFailed] = useState(false);

  useEffect(() => {
    try {
      const savedMode = localStorage.getItem("izzycheck.stageMode") as StageMode | null;
      if (savedMode === "standard" || savedMode === "contrast") {
        setStageMode(savedMode);
      }
    } catch {
      // Ignore localStorage errors in SSR / restricted environments
    }
  }, []);

  const handleSetMode = (mode: StageMode) => {
    setStageMode(mode);
    try {
      localStorage.setItem("izzycheck.stageMode", mode);
    } catch {
      // Ignore
    }
  };

  const resolvedTemplate = template || VEHICLE_TEMPLATES[bodyType] || VEHICLE_TEMPLATES["generic-passenger"];
  const frontWebp = resolvedTemplate.assetFrontWebp;
  const backWebp = resolvedTemplate.assetBackWebp;

  const rf3qMarkers = markers.filter((m) => m.rf3qAnchor);
  const lr3qMarkers = markers.filter((m) => m.lr3qAnchor);
  const underbodyMarkers = markers.filter((m) => m.underbodyAnchor || m.primaryCategory === "UNDERBODY");
  const offPhotoMarkers = markers.filter((m) => m.view === "off-photo");
  // The auxiliary row shows the underbody schematic (only with an underbody marker) and, next to it, the
  // "Poza zdjęciami" list of zones without a photo (interior). Underbody zones are drawn on the schematic, not listed.

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {isGeneric && (
            <div className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 dark:bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20">
              Makieta poglądowa ({labelPl})
            </div>
          )}
        </div>

        {/* 2-Mode Stage Presentation Switcher */}
        <div className="flex items-center gap-1 bg-slate-100 border border-slate-200 dark:bg-slate-900 dark:border-slate-800 p-1 rounded-xl shadow-inner">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 px-2 select-none">
            Widok makiety:
          </span>
          <button
            type="button"
            onClick={() => handleSetMode("standard")}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              stageMode === "standard"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-200 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800/60"
            }`}
            title="Standardowy fotorealistyczny render"
          >
            Standard
          </button>
          <button
            type="button"
            onClick={() => handleSetMode("contrast")}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              stageMode === "contrast"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-200 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800/60"
            }`}
            title="Zwiększony kontrast: przyciemniony pojazd dla maksymalnej widoczności markerów"
          >
            Kontrast
          </button>
        </div>
      </div>

      {/* Main 2 perspectives side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* VIEW 1: Right Front 3/4 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 relative shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
            <span className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-blue-500"></span>
              {PHOTO_1_CAPTION}
            </span>
            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              Markery w tym ujęciu: {rf3qMarkers.length}
            </span>
          </div>

          <div className="relative w-full aspect-[2/1] bg-white rounded-xl overflow-hidden flex items-center justify-center p-0 border border-slate-200 dark:border-slate-800 shadow-inner">
            <img
              src={frontWebp}
              alt={PHOTO_1_CAPTION}
              className={`w-full h-full object-contain select-none pointer-events-none transition-all duration-200 ${
                stageMode === "contrast" ? "grayscale contrast-[0.85] brightness-[0.92]" : ""
              }`}
            />

            {/* Render markers for RF 3/4 */}
            {rf3qMarkers.map((m) => {
              if (!m.rf3qAnchor) return null;
              const leftPct = (m.rf3qAnchor.x / 400) * 100;
              const topPct = (m.rf3qAnchor.y / 200) * 100;

              return (
                <div
                  key={`rf-${m.id}`}
                  style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 group z-10 cursor-pointer"
                >
                  <MarkerBadge marker={m} />
                  <MarkerTooltip marker={m} viewName="Zdjęcie 1" />
                </div>
              );
            })}
          </div>
        </div>

        {/* VIEW 2: Left Rear 3/4 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 relative shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
            <span className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-purple-500"></span>
              {PHOTO_2_CAPTION}
            </span>
            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              Markery w tym ujęciu: {lr3qMarkers.length}
            </span>
          </div>

          <div className="relative w-full aspect-[2/1] bg-white rounded-xl overflow-hidden flex items-center justify-center p-0 border border-slate-200 dark:border-slate-800 shadow-inner">
            <img
              src={backWebp}
              alt={PHOTO_2_CAPTION}
              className={`w-full h-full object-contain select-none pointer-events-none transition-all duration-200 ${
                stageMode === "contrast" ? "grayscale contrast-[0.85] brightness-[0.92]" : ""
              }`}
            />

            {/* Render markers for LR 3/4 */}
            {lr3qMarkers.map((m) => {
              if (!m.lr3qAnchor) return null;
              const leftPct = (m.lr3qAnchor.x / 400) * 100;
              const topPct = (m.lr3qAnchor.y / 200) * 100;

              return (
                <div
                  key={`lr-${m.id}`}
                  style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 group z-10 cursor-pointer"
                >
                  <MarkerBadge marker={m} />
                  <MarkerTooltip marker={m} viewName="Zdjęcie 2" />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* OPTIONAL VIEW 3: Underbody schematic + off-photo list (zone 17 interior, zone 18 underbody) */}
      {(hasUnderbodyView || offPhotoMarkers.length > 0) && (
        <div className="rounded-2xl border border-purple-500/20 bg-purple-50/50 p-4 space-y-3 dark:border-purple-500/30 dark:bg-purple-950/20">
          <div className="flex items-center justify-between border-b border-purple-500/20 pb-2">
            <span className="text-xs font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-purple-500 dark:bg-purple-400"></span>
              {hasUnderbodyView ? "Podwozie (widok od spodu)" : "Strefy poza zdjęciami"}
            </span>
            <span className="text-[11px] font-mono text-purple-700 dark:text-purple-300">
              {hasUnderbodyView ? "Widok pomocniczy podwozia" : "Strefy bez ujęcia na zdjęciach"}
            </span>
          </div>

          <div className="flex flex-col md:flex-row gap-4 items-start">
            {hasUnderbodyView && (
              <div className="w-full md:flex-1 max-w-xl mx-auto space-y-1">
                <div
                  style={{ aspectRatio: `${UNDERBODY_VIEWBOX_W} / ${UNDERBODY_VIEWBOX_H}` }}
                  className="relative w-full bg-slate-100 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800"
                >
                  {!underbodyImageFailed && (
                    <img
                      src={UNDERBODY_IMAGE_WEBP}
                      alt="Podwozie (widok od spodu)"
                      onError={() => {
                        console.warn(`[VehicleDamageViews] Underbody image not found: ${UNDERBODY_IMAGE_WEBP}`);
                        setUnderbodyImageFailed(true);
                      }}
                      className="w-full h-full object-contain select-none pointer-events-none"
                    />
                  )}

                  {underbodyMarkers.map((m) => {
                    const anchor = m.underbodyAnchor || { x: UNDERBODY_VIEWBOX_W / 2, y: UNDERBODY_VIEWBOX_H / 2 };
                    const leftPct = (anchor.x / UNDERBODY_VIEWBOX_W) * 100;
                    const topPct = (anchor.y / UNDERBODY_VIEWBOX_H) * 100;

                    return (
                      <div
                        key={`ub-${m.id}`}
                        style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                        className="absolute -translate-x-1/2 -translate-y-1/2 group z-10 cursor-pointer"
                      >
                        <MarkerBadge marker={m} />
                        <MarkerTooltip marker={m} viewName="Widok od spodu" />
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center">Przód pojazdu z lewej strony</p>
              </div>
            )}

            {offPhotoMarkers.length > 0 && (
            <div className="w-full md:w-64 space-y-2">
              {hasUnderbodyView && (
                <div className="text-xs font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider">Poza zdjęciami</div>
              )}
              {offPhotoMarkers.map((m) => (
                <div key={`off-${m.id}`} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200">
                  <span style={{ backgroundColor: m.colorHex }} className="mt-0.5 h-3 w-3 shrink-0 rounded-full"></span>
                  <span>
                    {m.titlePl}
                    {m.hintPl && <span className="block text-[10px] text-slate-500">{m.hintPl}</span>}
                  </span>
                </div>
              ))}
            </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MarkerBadge({ marker }: { marker: ProcessedMarkerItem }) {
  return (
    <div
      style={{ backgroundColor: marker.colorHex }}
      className="h-4 w-4 rounded-full shadow-lg ring-2 ring-white drop-shadow-md transition-transform group-hover:scale-125"
    />
  );
}

function MarkerTooltip({ marker, viewName }: { marker: ProcessedMarkerItem; viewName: string }) {
  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 p-2 bg-white text-slate-900 border border-slate-200 dark:bg-slate-900 dark:border-slate-700 rounded-lg text-[11px] dark:text-white shadow-xl z-30 pointer-events-none space-y-1">
      <div className="font-bold flex items-center justify-between gap-2">
        <span>{marker.titlePl}</span>
        <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400 shrink-0">{viewName}</span>
      </div>
      {marker.hintPl && <p className="text-slate-500 dark:text-slate-400">{marker.hintPl}</p>}
      <div className="text-[10px] text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-800 pt-1">{marker.categoryLabelPl}</div>
    </div>
  );
}
