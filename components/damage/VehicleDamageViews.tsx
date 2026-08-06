"use client";

import React from "react";
import { ProcessedMarkerItem } from "@/lib/damage/build-damage-presentation";
import { VehicleBodyType } from "@/lib/damage/vehicle-templates";

interface VehicleDamageViewsProps {
  bodyType: VehicleBodyType;
  labelPl: string;
  isGeneric: boolean;
  markers: ProcessedMarkerItem[];
  hasUnderbodyView: boolean;
}

export function VehicleDamageViews({
  bodyType,
  labelPl,
  isGeneric,
  markers,
  hasUnderbodyView,
}: VehicleDamageViewsProps) {
  const rf3qMarkers = markers.filter((m) => m.rf3qAnchor);
  const lr3qMarkers = markers.filter((m) => m.lr3qAnchor);
  const underbodyMarkers = markers.filter((m) => m.underbodyAnchor || m.primaryCategory === "UNDERBODY");

  return (
    <div className="space-y-6">
      {isGeneric && (
        <div className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-400 border border-amber-500/20">
          Makieta poglądowa ({labelPl})
        </div>
      )}

      {/* Main 2 perspectives side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* VIEW 1: Right Front 3/4 */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 space-y-3 relative">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-blue-500"></span>
              Prawy skos od przodu (3/4)
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              Markery w tym ujęciu: {rf3qMarkers.length}
            </span>
          </div>

          <div className="relative w-full aspect-[2/1] bg-slate-900/40 rounded-xl overflow-hidden flex items-center justify-center p-2 border border-slate-800/60">
            <RightFront3QSvg bodyType={bodyType} />

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
                  <MarkerTooltip marker={m} viewName="Prawy przód" />
                </div>
              );
            })}
          </div>
        </div>

        {/* VIEW 2: Left Rear 3/4 */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 space-y-3 relative">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-purple-500"></span>
              Lewy skos od tyłu (3/4)
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              Markery w tym ujęciu: {lr3qMarkers.length}
            </span>
          </div>

          <div className="relative w-full aspect-[2/1] bg-slate-900/40 rounded-xl overflow-hidden flex items-center justify-center p-2 border border-slate-800/60">
            <LeftRear3QSvg bodyType={bodyType} />

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
                  <MarkerTooltip marker={m} viewName="Lewy tył" />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* OPTIONAL VIEW 3: Underbody Bottom View */}
      {hasUnderbodyView && (
        <div className="rounded-2xl border border-purple-500/30 bg-purple-950/20 p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-purple-500/20 pb-2">
            <span className="text-xs font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-purple-400"></span>
              Widok od spodu (Podwozie)
            </span>
            <span className="text-[11px] font-mono text-purple-300">
              Widok pomocniczy podwozia
            </span>
          </div>

          <div className="relative w-full aspect-[3/1] max-w-xl mx-auto bg-slate-950 rounded-xl overflow-hidden flex items-center justify-center p-2 border border-slate-800">
            <UnderbodySvg />

            {underbodyMarkers.map((m) => {
              const anchor = m.underbodyAnchor || { x: 200, y: 100 };
              const leftPct = (anchor.x / 400) * 100;
              const topPct = (anchor.y / 200) * 100;

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
        </div>
      )}
    </div>
  );
}

function MarkerBadge({ marker }: { marker: ProcessedMarkerItem }) {
  return (
    <div
      style={{ backgroundColor: marker.colorHex }}
      className="h-6 w-6 rounded-full flex items-center justify-center text-white text-xs font-black shadow-lg ring-2 ring-slate-950 transition-transform group-hover:scale-125"
    >
      {marker.markerIndex}
    </div>
  );
}

function MarkerTooltip({ marker, viewName }: { marker: ProcessedMarkerItem; viewName: string }) {
  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 p-2 bg-slate-900 border border-slate-700 rounded-lg text-[11px] text-white shadow-xl z-30 pointer-events-none space-y-1">
      <div className="font-bold flex items-center justify-between">
        <span>Marker #{marker.markerIndex}</span>
        <span className="text-[10px] text-slate-400">{viewName}</span>
      </div>
      <p className="text-slate-300 font-medium">{marker.labelPl}</p>
      <div className="text-[10px] text-slate-400 border-t border-slate-800 pt-1 flex justify-between">
        <span>{marker.categoryLabelPl}</span>
        <span className="font-mono">Kod: {marker.sourceCode}</span>
      </div>
    </div>
  );
}

// Right Front 3/4 SVG Canvas (400 x 200) with Body Type Silhouettes
function RightFront3QSvg({ bodyType }: { bodyType: VehicleBodyType }) {
  // SVG paths depending on bodyType (SUV, Sedan, Hatchback, Wagon)
  const isSuv = bodyType === "passenger-suv";
  const isWagon = bodyType === "passenger-wagon";
  const isHatch = bodyType === "passenger-hatchback";

  const bodyPath = isSuv
    ? "M 50 115 L 80 80 L 130 45 L 210 40 L 265 65 L 305 90 L 345 110 L 375 130 L 365 155 L 325 165 L 135 165 L 75 150 Z"
    : isWagon
    ? "M 50 110 L 80 75 L 140 50 L 230 48 L 265 68 L 305 92 L 345 112 L 370 132 L 360 155 L 320 165 L 140 165 L 75 150 Z"
    : isHatch
    ? "M 65 115 L 95 82 L 145 52 L 215 50 L 260 70 L 300 95 L 340 115 L 370 135 L 360 155 L 320 165 L 140 165 L 80 155 Z"
    : "M 60 120 L 90 90 L 140 55 L 210 50 L 260 70 L 300 95 L 340 115 L 370 135 L 360 155 L 320 165 L 140 165 L 80 155 Z";

  const glassPath = isSuv
    ? "M 135 50 L 205 45 L 260 70 L 215 90 L 145 90 Z"
    : isWagon
    ? "M 135 55 L 225 53 L 260 73 L 215 93 L 145 93 Z"
    : "M 145 60 L 205 55 L 255 75 L 215 95 L 155 95 Z";

  return (
    <svg viewBox="0 0 400 200" className="w-full h-full text-slate-700 select-none">
      <defs>
        <linearGradient id="carBodyRF" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#334155" />
          <stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
        <linearGradient id="glassRF" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#0284c7" stopOpacity="0.2" />
        </linearGradient>
      </defs>

      {/* Shadow */}
      <ellipse cx="220" cy="165" rx="150" ry="20" fill="#020617" opacity="0.6" />

      {/* Main Car Silhouette */}
      <path d={bodyPath} fill="url(#carBodyRF)" stroke="#64748b" strokeWidth="2" />

      {/* Roof & Windshield Glasses */}
      <path d={glassPath} fill="url(#glassRF)" stroke="#38bdf8" strokeWidth="1.5" />

      {/* Front Hood Line */}
      <path d="M 255 75 L 300 95 L 345 120" stroke="#475569" strokeWidth="1.5" fill="none" />

      {/* Right Front Wheel */}
      <ellipse cx="330" cy="155" rx="22" ry="14" fill="#0f172a" stroke="#94a3b8" strokeWidth="2" />
      <ellipse cx="330" cy="155" rx="12" ry="7" fill="#334155" />

      {/* Right Rear Wheel */}
      <ellipse cx="140" cy="155" rx="20" ry="13" fill="#0f172a" stroke="#94a3b8" strokeWidth="2" />
      <ellipse cx="140" cy="155" rx="10" ry="6" fill="#334155" />

      {/* Headlights Front Right */}
      <polygon points="340,120 365,135 345,140" fill="#fef08a" opacity="0.8" stroke="#facc15" strokeWidth="1" />
      {/* Front Grille */}
      <path d="M 310 125 L 340 138 L 335 150 L 305 135 Z" fill="#020617" stroke="#475569" strokeWidth="1" />
    </svg>
  );
}

// Left Rear 3/4 SVG Canvas (400 x 200) with Body Type Silhouettes
function LeftRear3QSvg({ bodyType }: { bodyType: VehicleBodyType }) {
  const isSuv = bodyType === "passenger-suv";
  const isWagon = bodyType === "passenger-wagon";
  const isHatch = bodyType === "passenger-hatchback";

  const bodyPath = isSuv
    ? "M 45 125 L 60 100 L 105 70 L 155 45 L 225 42 L 275 65 L 335 90 L 355 115 L 335 155 L 260 165 L 90 165 Z"
    : isWagon
    ? "M 45 125 L 55 90 L 100 65 L 155 48 L 225 46 L 275 68 L 335 92 L 355 118 L 335 155 L 260 165 L 90 165 Z"
    : isHatch
    ? "M 50 130 L 65 105 L 105 72 L 155 50 L 220 48 L 270 70 L 330 95 L 350 120 L 330 155 L 260 165 L 90 165 Z"
    : "M 50 135 L 70 115 L 115 85 L 160 55 L 220 50 L 270 70 L 330 95 L 350 120 L 330 155 L 260 165 L 90 165 Z";

  const glassPath = isSuv
    ? "M 115 70 L 155 50 L 220 45 L 255 70 L 170 90 Z"
    : isWagon
    ? "M 105 65 L 155 50 L 220 48 L 255 70 L 165 92 Z"
    : "M 125 85 L 165 60 L 215 55 L 250 80 L 175 95 Z";

  return (
    <svg viewBox="0 0 400 200" className="w-full h-full text-slate-700 select-none">
      <defs>
        <linearGradient id="carBodyLR" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#334155" />
          <stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
        <linearGradient id="glassLR" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#0284c7" stopOpacity="0.2" />
        </linearGradient>
      </defs>

      {/* Shadow */}
      <ellipse cx="180" cy="165" rx="150" ry="20" fill="#020617" opacity="0.6" />

      {/* Main Car Silhouette */}
      <path d={bodyPath} fill="url(#carBodyLR)" stroke="#64748b" strokeWidth="2" />

      {/* Roof & Rear Windshield Glasses */}
      <path d={glassPath} fill="url(#glassLR)" stroke="#38bdf8" strokeWidth="1.5" />

      {/* Trunk Line */}
      <path d="M 70 115 L 115 85 L 175 95" stroke="#475569" strokeWidth="1.5" fill="none" />

      {/* Rear Left Wheel */}
      <ellipse cx="110" cy="155" rx="22" ry="14" fill="#0f172a" stroke="#94a3b8" strokeWidth="2" />
      <ellipse cx="110" cy="155" rx="12" ry="7" fill="#334155" />

      {/* Front Left Wheel */}
      <ellipse cx="290" cy="155" rx="20" ry="13" fill="#0f172a" stroke="#94a3b8" strokeWidth="2" />
      <ellipse cx="290" cy="155" rx="10" ry="6" fill="#334155" />

      {/* Rear Taillights Left */}
      <polygon points="60,125 90,115 85,135" fill="#f87171" opacity="0.9" stroke="#ef4444" strokeWidth="1" />
      {/* Bumper Bottom Line */}
      <path d="M 60 135 L 90 155 L 130 155" stroke="#334155" strokeWidth="2" fill="none" />
    </svg>
  );
}

// Underbody Bottom View SVG (400 x 200)
function UnderbodySvg() {
  return (
    <svg viewBox="0 0 400 200" className="w-full h-full text-slate-700 select-none">
      {/* Outer Outline */}
      <rect x="70" y="40" width="260" height="120" rx="30" fill="#0f172a" stroke="#64748b" strokeWidth="2" />

      {/* Axles */}
      <line x1="110" y1="30" x2="110" y2="170" stroke="#475569" strokeWidth="4" />
      <line x1="290" y1="30" x2="290" y2="170" stroke="#475569" strokeWidth="4" />

      {/* Wheels */}
      <rect x="95" y="20" width="30" height="18" rx="4" fill="#1e293b" stroke="#94a3b8" strokeWidth="1" />
      <rect x="95" y="162" width="30" height="18" rx="4" fill="#1e293b" stroke="#94a3b8" strokeWidth="1" />
      <rect x="275" y="20" width="30" height="18" rx="4" fill="#1e293b" stroke="#94a3b8" strokeWidth="1" />
      <rect x="275" y="162" width="30" height="18" rx="4" fill="#1e293b" stroke="#94a3b8" strokeWidth="1" />

      {/* Floorpan / Underbody Center */}
      <rect x="150" y="60" width="100" height="80" rx="10" fill="#1e293b" stroke="#8b5cf6" strokeWidth="1.5" strokeDasharray="4 2" />
      <text x="200" y="104" textAnchor="middle" fill="#a78bfa" fontSize="11" fontWeight="bold">
        SCHEMAT PODWOZIA
      </text>
    </svg>
  );
}
