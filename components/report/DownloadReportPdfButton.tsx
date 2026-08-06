"use client";

import React, { useState } from "react";
import { Download, Loader2 } from "lucide-react";

interface DownloadReportPdfButtonProps {
  reportId: string;
  vin: string;
  className?: string;
}

export function DownloadReportPdfButton({
  reportId,
  vin,
  className = "",
}: DownloadReportPdfButtonProps) {
  const [downloading, setDownloading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleDownload = async () => {
    setDownloading(true);
    setErrorMessage("");

    try {
      const res = await fetch(`/api/reports/${reportId}/pdf`);
      if (!res.ok) {
        let errJson;
        try {
          errJson = await res.json();
        } catch {
          // ignore
        }
        throw new Error(errJson?.error || `Błąd serwera podczas generowania PDF (HTTP ${res.status}).`);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Raport-IzzyCheck-${vin}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setErrorMessage(err.message || "Błąd pobierania pliku PDF.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="inline-flex flex-col items-end">
      <button
        onClick={handleDownload}
        disabled={downloading}
        className={`inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-lg hover:bg-blue-500 disabled:opacity-50 transition-all ${className}`}
      >
        {downloading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Generowanie PDF...</span>
          </>
        ) : (
          <>
            <Download className="h-4 w-4" />
            <span>Pobierz PDF</span>
          </>
        )}
      </button>

      {errorMessage && (
        <span className="text-[11px] font-semibold text-red-400 mt-1">
          {errorMessage}
        </span>
      )}
    </div>
  );
}
