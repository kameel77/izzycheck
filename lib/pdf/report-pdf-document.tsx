import React from "react";
import path from "node:path";
import fs from "node:fs";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  Svg,
  Path,
  Circle,
  Rect,
  Line,
  G,
  Font,
} from "@react-pdf/renderer";
import { ReportPdfViewModel, ReportPdfClaimItem } from "./report-pdf-view-model.ts";
import { ISSUER_CONFIG } from "../config/issuer.ts";
import { sortEquipmentAlphabetically, chunkEquipmentForRows } from "../reports/equipment.ts";
import pkg from "../../package.json" with { type: "json" };

// Register local Unicode TTF font for Polish characters (ą ć ę ł ń ó ś ź ż Ą Ć Ę Ł Ń Ó Ś Ź Ż)
const fontsDir = path.join(process.cwd(), "public", "fonts");

Font.register({
  family: "ArialCustom",
  fonts: [
    { src: path.join(fontsDir, "Arial.ttf"), fontWeight: "normal" },
    { src: path.join(fontsDir, "Arial-Bold.ttf"), fontWeight: "bold" },
  ],
});

const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 9,
    fontFamily: "ArialCustom",
    color: "#1e293b",
    backgroundColor: "#ffffff",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
    paddingBottom: 10,
    marginBottom: 15,
  },
  logoText: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#0f172a",
  },
  logoSub: {
    fontSize: 8,
    color: "#3b82f6",
    fontWeight: "bold",
  },
  reportMeta: {
    textAlign: "right",
  },
  reportTitle: {
    fontSize: 8,
    color: "#64748b",
  },
  reportIdText: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#0f172a",
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#0f172a",
    backgroundColor: "#f1f5f9",
    padding: 5,
    borderRadius: 4,
    marginTop: 10,
    marginBottom: 8,
  },
  card: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 6,
    padding: 10,
    marginBottom: 10,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  col: {
    flexDirection: "column",
    flex: 1,
  },
  label: {
    fontSize: 7,
    color: "#64748b",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  value: {
    fontSize: 9,
    fontWeight: "bold",
    color: "#0f172a",
  },
  valueAccent: {
    fontSize: 9,
    fontWeight: "bold",
    color: "#ef4444",
  },
  legendBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#f8fafc",
    padding: 6,
    borderRadius: 4,
    marginBottom: 8,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    fontSize: 7,
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  table: {
    width: "100%",
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 4,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f8fafc",
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
    padding: 4,
    fontSize: 7,
    fontWeight: "bold",
    color: "#475569",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    padding: 4,
    fontSize: 8,
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 30,
    right: 30,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 6,
    fontSize: 7,
    color: "#94a3b8",
  },
  disclaimerBox: {
    backgroundColor: "#fffbe6",
    borderWidth: 1,
    borderColor: "#ffe58f",
    padding: 8,
    borderRadius: 4,
    marginTop: 10,
    fontSize: 7,
    color: "#8c6b00",
  },
  eqGridRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  eqGridCell: {
    width: "33.33%",
    paddingRight: 4,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  eqBullet: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: "#3b82f6",
    marginTop: 3,
    marginRight: 3,
  },
  eqText: {
    fontSize: 6.5,
    color: "#334155",
    flex: 1,
    lineHeight: 1.2,
  },
  optCard: {
    width: "49%",
    borderWidth: 1,
    borderColor: "#bfdbfe",
    backgroundColor: "#eff6ff",
    borderRadius: 4,
    padding: 4,
    marginBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  optBadge: {
    fontSize: 6,
    fontWeight: "bold",
    color: "#1d4ed8",
    backgroundColor: "#dbeafe",
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderRadius: 2,
  },
  optText: {
    fontSize: 7,
    fontWeight: "bold",
    color: "#1e3a8a",
    flex: 1,
    marginRight: 4,
  },
  emptyNoticeBox: {
    padding: 6,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 4,
    marginBottom: 8,
  },
  emptyNoticeText: {
    fontSize: 7,
    color: "#64748b",
  },
  failedNoticeBox: {
    padding: 6,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 4,
    marginBottom: 8,
  },
  failedNoticeText: {
    fontSize: 7,
    color: "#b91c1c",
    fontWeight: "bold",
  },
  incompleteBanner: {
    backgroundColor: "#fef2f2",
    borderWidth: 1.5,
    borderColor: "#ef4444",
    borderRadius: 4,
    padding: 6,
    marginBottom: 8,
  },
  incompleteBannerTitle: {
    fontSize: 7.5,
    fontWeight: "bold",
    color: "#991b1b",
    marginBottom: 2,
  },
  incompleteBannerText: {
    fontSize: 6.5,
    color: "#b91c1c",
  },
});

export function ReportPdfDocument({ model }: { model: ReportPdfViewModel }): React.ReactElement<any> {
  const isValuationFailed = model.valuationStatus === "FAILED" || model.valuationStatus === "NIEWYKONANO";
  const sortedStd = sortEquipmentAlphabetically(model.standardEquipment || []);
  const sortedOpt = sortEquipmentAlphabetically(model.optionalEquipment || []);
  const stdRows = chunkEquipmentForRows(sortedStd, 3);
  const optRows = chunkEquipmentForRows(sortedOpt, 2);

  return (
    <Document title={`Raport-IzzyCheck-${model.vin}`} author="IzzyCheck System">
      {/* PAGE 1: Vehicle & Report Summary */}
      <Page size="A4" style={styles.page}>
        <PdfHeader model={model} />

        {model.status === "PARTIALLY_FAILED" && (
          <View style={styles.incompleteBanner}>
            <Text style={styles.incompleteBannerTitle}>
              UWAGA: DOKUMENT ZATWIERDZONY JAKO NIEPEŁNY (STAN AS-IS)
            </Text>
            <Text style={styles.incompleteBannerText}>
              Raport zawiera niekompletne dane z powodu błędów w modułach źródłowych Audatex:
              {model.valuationStatus === "FAILED" && " • Brak wyceny i specyfikacji technicznej"}
              {model.claimCheckStatus === "FAILED" && " • Brak kontroli historii szkód"}
              {model.claimDetailsStatus === "FAILED" && " • Brak szczegółów historii szkód"}
            </Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>1. Identyfikacja Pojazdu i Raportu</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={styles.label}>Pojazd (Marka / Model)</Text>
              <Text style={styles.value}>
                {model.make ? `${model.make} ${model.model || ""} ${model.variant || ""}` : `VIN: ${model.vin}`}
              </Text>
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Numer VIN</Text>
              <Text style={styles.value}>{model.vin}</Text>
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={styles.label}>Data 1. Rejestracji</Text>
              <Text style={styles.value}>{model.firstRegistrationDate}</Text>
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Przebieg z Zapytania</Text>
              <Text style={styles.value}>
                {model.mileage ? `${model.mileage.toLocaleString("pl-PL")} km` : "Średni rynkowy"}
              </Text>
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Kod IBS (AudaValuation)</Text>
              <Text style={styles.value}>{model.ibsCode || "—"}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>2. Wyniki Modułów Integracyjnych</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={styles.label}>Moduł 1: AudaValuation</Text>
              <Text style={styles.value}>{model.valuationStatus}</Text>
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Moduł 2: Control claims (hasHistory)</Text>
              <Text style={styles.value}>{model.claimCheckStatus}</Text>
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Moduł 3: Claim details (getDetails)</Text>
              <Text style={styles.value}>{model.claimDetailsStatus}</Text>
            </View>
          </View>
        </View>

        {model.marketPriceCob !== undefined && (
          <>
            <Text style={styles.sectionTitle}>3. Podsumowanie Wyceny Pojazdu</Text>
            <View style={styles.card}>
              <View style={styles.row}>
                <View style={styles.col}>
                  <Text style={styles.label}>Cena Nowego (CVv)</Text>
                  <Text style={styles.value}>{model.newPriceCv?.toLocaleString("pl-PL")} PLN netto (bez VAT)</Text>
                </View>
                <View style={styles.col}>
                  <Text style={styles.label}>Cena Rynkowa (COBv)</Text>
                  <Text style={styles.valueAccent}>{model.marketPriceCob?.toLocaleString("pl-PL")} PLN netto (bez VAT)</Text>
                </View>
                <View style={styles.col}>
                  <Text style={styles.label}>Wartość Techniczna (THv)</Text>
                  <Text style={styles.value}>{model.technicalValueTh?.toLocaleString("pl-PL")} PLN netto (bez VAT)</Text>
                </View>
              </View>
            </View>
          </>
        )}

        {model.technicalSpec && (
          <>
            <Text style={styles.sectionTitle}>4. Specyfikacja Techniczna Pojazdu</Text>
            <View style={styles.card}>
              <View style={styles.row}>
                <View style={styles.col}>
                  <Text style={styles.label}>Pojemność Silnika</Text>
                  <Text style={styles.value}>
                    {model.technicalSpec.engineCapacityCm3 ? `${model.technicalSpec.engineCapacityCm3.toLocaleString("pl-PL")} cm³` : "—"}
                  </Text>
                </View>
                <View style={styles.col}>
                  <Text style={styles.label}>Moc Silnika</Text>
                  <Text style={styles.value}>
                    {model.technicalSpec.enginePowerKw && model.technicalSpec.enginePowerHp
                      ? `${model.technicalSpec.enginePowerKw} kW (${model.technicalSpec.enginePowerHp} KM${model.technicalSpec.isEnginePowerHpCalculated ? " — przeliczone" : ""})`
                      : model.technicalSpec.enginePowerKw
                      ? `${model.technicalSpec.enginePowerKw} kW`
                      : model.technicalSpec.enginePowerHp
                      ? `${model.technicalSpec.enginePowerHp} KM`
                      : "—"}
                  </Text>
                </View>
                <View style={styles.col}>
                  <Text style={styles.label}>Paliwo / Napęd</Text>
                  <Text style={styles.value}>
                    {[model.technicalSpec.fuelType, model.technicalSpec.driveType].filter(Boolean).join(" / ") || "—"}
                  </Text>
                </View>
                <View style={styles.col}>
                  <Text style={styles.label}>Skrzynia Biegów</Text>
                  <Text style={styles.value}>
                    {model.technicalSpec.gearboxType ? `${model.technicalSpec.gearboxType}${model.technicalSpec.gearCount ? ` (${model.technicalSpec.gearCount}b)` : ""}` : "—"}
                  </Text>
                </View>
              </View>

              <View style={[styles.row, { marginTop: 4 }]}>
                <View style={styles.col}>
                  <Text style={styles.label}>Nadwozie / Miejsca</Text>
                  <Text style={styles.value}>
                    {[model.technicalSpec.bodyType, model.technicalSpec.seatsCount ? `${model.technicalSpec.seatsCount} miejsc` : undefined].filter(Boolean).join(" / ") || "—"}
                  </Text>
                </View>
                <View style={styles.col}>
                  <Text style={styles.label}>Masa Własna / DMC</Text>
                  <Text style={styles.value}>
                    {model.technicalSpec.curbWeightKg ? `${model.technicalSpec.curbWeightKg} kg / ${model.technicalSpec.grossWeightKg || "—"} kg` : "—"}
                  </Text>
                </View>
                <View style={styles.col}>
                  <Text style={styles.label}>Wymiary (Dł/Szer/Wys)</Text>
                  <Text style={styles.value}>
                    {model.technicalSpec.lengthMm ? `${model.technicalSpec.lengthMm} x ${model.technicalSpec.widthMm} x ${model.technicalSpec.heightMm} mm` : "—"}
                  </Text>
                </View>
                <View style={styles.col}>
                  <Text style={styles.label}>Koła / Emisja</Text>
                  <Text style={styles.value}>
                    {[model.technicalSpec.wheelSize, model.technicalSpec.emissionStandard].filter(Boolean).join(" / ") || "—"}
                  </Text>
                </View>
              </View>

              {/* Unmapped Raw Attributes Fallback */}
              {model.technicalSpec.rawAttributes && Object.keys(model.technicalSpec.rawAttributes).length > 0 && (
                <View style={{ marginTop: 6, borderTopWidth: 1, borderTopColor: "#e2e8f0", paddingTop: 4 }}>
                  <Text style={[styles.label, { marginBottom: 3 }]}>Pozostałe parametry od Audatex</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    {Object.entries(model.technicalSpec.rawAttributes).map(([k, v]) => (
                      <View key={k} style={{ width: "33.3%", marginBottom: 3, paddingRight: 4 }}>
                        <Text style={{ fontSize: 6, color: "#64748b" }}>{k}</Text>
                        <Text style={{ fontSize: 7, fontWeight: "bold", color: "#334155" }}>{String(v)}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          </>
        )}

        {/* 5. Wyposażenie Dodatkowe & Pakiety (Opcje) */}
        <Text style={styles.sectionTitle}>
          5. Wyposażenie Dodatkowe & Pakiety {sortedOpt.length > 0 ? `(${sortedOpt.length} pozycji)` : ""}
        </Text>
        {isValuationFailed ? (
          <View style={styles.failedNoticeBox}>
            <Text style={styles.failedNoticeText}>Moduł wyceny nie został wykonany</Text>
          </View>
        ) : sortedOpt.length === 0 ? (
          <View style={styles.emptyNoticeBox}>
            <Text style={styles.emptyNoticeText}>Brak zarejestrowanego wyposażenia opcjonalnego w Audatex</Text>
          </View>
        ) : (
          <View style={{ marginBottom: 6 }}>
            {optRows.map((row, rIdx) => (
              <View key={`opt-row-${rIdx}`} style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
                {row.map((item, cIdx) => (
                  <View key={`opt-item-${rIdx}-${cIdx}`} style={styles.optCard}>
                    <Text style={styles.optText}>{item.name}</Text>
                    {item.code && <Text style={styles.optBadge}>Kod: {item.code}</Text>}
                  </View>
                ))}
                {row.length === 1 && <View style={{ width: "49%" }} />}
              </View>
            ))}
          </View>
        )}

        {/* 6. Wyposażenie Standardowe (Siatka 3-kolumnowa w układzie wierszowym) */}
        <Text style={styles.sectionTitle}>
          6. Wyposażenie Standardowe {sortedStd.length > 0 ? `(${sortedStd.length} pozycji)` : ""}
        </Text>
        {isValuationFailed ? (
          <View style={styles.failedNoticeBox}>
            <Text style={styles.failedNoticeText}>Moduł wyceny nie został wykonany</Text>
          </View>
        ) : sortedStd.length === 0 ? (
          <View style={styles.emptyNoticeBox}>
            <Text style={styles.emptyNoticeText}>Audatex nie zwrócił pozycji wyposażenia</Text>
          </View>
        ) : (
          <View style={{ marginBottom: 8 }}>
            {stdRows.map((row, rIdx) => (
              <View key={`std-row-${rIdx}`} style={styles.eqGridRow}>
                {row.map((item, cIdx) => (
                  <View key={`std-item-${rIdx}-${cIdx}`} style={styles.eqGridCell}>
                    <View style={styles.eqBullet} />
                    <Text style={styles.eqText}>
                      {item.name} {item.code ? `(${item.code})` : ""}
                    </Text>
                  </View>
                ))}
                {Array.from({ length: 3 - row.length }).map((_, padIdx) => (
                  <View key={`pad-${padIdx}`} style={{ width: "33.33%" }} />
                ))}
              </View>
            ))}
          </View>
        )}

        <View style={styles.disclaimerBox}>
          <Text style={{ fontWeight: "bold", marginBottom: 3, color: "#78350f" }}>
            [TYMCZASOWY SZABLON INFORMACYJNY - DO WERYFIKACJI I ZASTĄPIENIA PRZEZ KANCELARIĘ PRAWNĄ]
          </Text>
          <Text style={{ marginBottom: 2 }}>
            1. Niniejszy raport ma charakter analityczno-informacyjny i został sporządzony na podstawie danych dostarczonych przez system Audatex (AudaValuation oraz Claims History Engine). Dokument nie stanowi urzędowej opinii biegłego rzeczoznawcy majątkowego ani gwarancji bezwypadkowości pojazdu.
          </Text>
          <Text style={{ marginBottom: 2 }}>
            2. Wszelkie zaprezentowane wartości kwotowe są wartościami bazowymi netto (bez VAT), zgodnie z danymi źródłowymi Audatex. System IzzyCheck nie dokonuje wyliczeń ani korekt stawek podatku od towarów i usług.
          </Text>
          <Text>
            3. Zastrzeżenie prawne (wersja robocza): Zakres odpowiedzialności wystawcy wobec nabywcy raportu (w szczególności konsumenta) podlega ostatecznej regulacji w regulaminie usługi zgodnie z prawem właściwym.
          </Text>
        </View>

        <PdfFooter />
      </Page>

      {/* PAGE 2+: Damage Claims & Visualizations */}
      {model.hasClaims &&
        model.claims.map((claim) => (
          <Page key={claim.claimId} size="A4" style={styles.page}>
            <PdfHeader model={model} />

            <Text style={styles.sectionTitle}>
              Historia Szkody #{claim.index} (Identyfikator: {claim.claimId})
            </Text>

            <View style={styles.card}>
              <View style={styles.row}>
                <View style={styles.col}>
                  <Text style={styles.label}>Data Zdarzenia</Text>
                  <Text style={styles.value}>{claim.accidentDate || "Brak danych"}</Text>
                </View>
                <View style={styles.col}>
                  <Text style={styles.label}>Kraj Zgłoszenia</Text>
                  <Text style={styles.value}>{claim.country || "PL"}</Text>
                </View>
                <View style={styles.col}>
                  <Text style={styles.label}>Wartość Szkody</Text>
                  <Text style={styles.valueAccent}>
                    {claim.damageValue ? `${claim.damageValue.toLocaleString("pl-PL")} ${claim.currency} netto (bez VAT)` : "Brak kwoty"}
                  </Text>
                </View>
                <View style={styles.col}>
                  <Text style={styles.label}>Status Całkowity</Text>
                  <Text style={styles.value}>{claim.isTotalLoss ? "SZKODA CAŁKOWITA" : "Częściowa"}</Text>
                </View>
              </View>

              <View style={styles.row}>
                <View style={styles.col}>
                  <Text style={styles.label}>Kod Mandatu Audatex</Text>
                  <Text style={styles.value}>{claim.mandateCode || "—"}</Text>
                </View>
                <View style={{ flex: 3 }}>
                  <Text style={styles.label}>Kwalifikacja zdarzenia</Text>
                  <Text style={styles.value}>{claim.mandateDescription || "Brak opisu"}</Text>
                </View>
              </View>
            </View>

            {/* Category Legend Box for PDF */}
            <View style={styles.legendBox}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: "#ef4444" }]} />
                <Text>Nadwozie i konstrukcja</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: "#3b82f6" }]} />
                <Text>Szyby i oświetlenie</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: "#f97316" }]} />
                <Text>Mechaniczne</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: "#8b5cf6" }]} />
                <Text>Podwozie</Text>
              </View>
            </View>

            {/* Visual Vector Views */}
            <Text style={{ fontSize: 9, fontWeight: "bold", marginBottom: 6, color: "#0f172a" }}>
              Mapa Szkody Według Audatex (Prawy Przód 3/4 & Lewy Tył 3/4)
            </Text>

            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }}>
              {/* Right Front 3/4 View */}
              <View style={{ width: "48%", border: "1px solid #cbd5e1", borderRadius: 4, padding: 4 }}>
                <Text style={{ fontSize: 7, fontWeight: "bold", color: "#3b82f6", marginBottom: 4 }}>
                  Prawy skos od przodu (3/4)
                </Text>
                <PdfRightFrontSvg claimItem={claim} />
              </View>

              {/* Left Rear 3/4 View */}
              <View style={{ width: "48%", border: "1px solid #cbd5e1", borderRadius: 4, padding: 4 }}>
                <Text style={{ fontSize: 7, fontWeight: "bold", color: "#8b5cf6", marginBottom: 4 }}>
                  Lewy skos od tyłu (3/4)
                </Text>
                <PdfLeftRearSvg claimItem={claim} />
              </View>
            </View>

            {/* Underbody Schematic View if underbody damage present */}
            {claim.presentation.hasUnderbodyView && (
              <View style={{ marginBottom: 10 }}>
                <Text style={{ fontSize: 8, fontWeight: "bold", color: "#6b21a8", marginBottom: 3 }}>
                  Schemat Podwozia Pojazdu (Elementy Nośne / Zawieszenie / Rama)
                </Text>
                <View style={{ border: "1px solid #ddd6fe", borderRadius: 4, padding: 4, backgroundColor: "#faf5ff" }}>
                  <PdfUnderbodySvg claimItem={claim} />
                </View>
              </View>
            )}

            {/* Damage Details Table */}
            <Text style={{ fontSize: 9, fontWeight: "bold", marginBottom: 4, color: "#0f172a" }}>
              Zarejestrowane Strefy i Grupy Części (Kolejność Narastająca):
            </Text>

            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={{ width: "8%", fontWeight: "bold" }}>#</Text>
                <Text style={{ width: "22%", fontWeight: "bold" }}>Źródło</Text>
                <Text style={{ width: "15%", fontWeight: "bold" }}>Kod</Text>
                <Text style={{ width: "35%", fontWeight: "bold" }}>Nazwa strefy / opis</Text>
                <Text style={{ width: "20%", fontWeight: "bold" }}>Widoczność</Text>
              </View>

              {claim.presentation.markers.map((m) => (
                <View key={m.id} style={styles.tableRow}>
                  <Text style={{ width: "8%", fontWeight: "bold", color: m.colorHex }}>{m.markerIndex}</Text>
                  <Text style={{ width: "22%" }}>{m.sourceKind === "zone" ? "Strefa Audatex" : "Grupa części"}</Text>
                  <Text style={{ width: "15%", fontWeight: "bold" }}>{m.sourceCode}</Text>
                  <Text style={{ width: "35%" }}>{m.labelPl}</Text>
                  <Text style={{ width: "20%", color: m.rf3qAnchor || m.lr3qAnchor ? "#059669" : "#64748b" }}>
                    {m.viewVisibilityText}
                  </Text>
                </View>
              ))}
            </View>

            <PdfFooter />
          </Page>
        ))}
    </Document>
  );
}

function PdfHeader({ model }: { model: ReportPdfViewModel }) {
  const refText = model.publicReference || `ID: #${model.reportId.substring(0, 8)}`;
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.logoText}>IzzyCheck</Text>
        <Text style={styles.logoSub}>RAPORT HISTORII I WYCENY POJAZDU</Text>
        <Text style={{ fontSize: 6.5, color: "#64748b", marginTop: 2 }}>
          Wystawca: {ISSUER_CONFIG.companyName} | NIP: {ISSUER_CONFIG.taxId} | {ISSUER_CONFIG.website}
        </Text>
      </View>
      <View style={styles.reportMeta}>
        <Text style={styles.reportTitle}>Nr ref: {refText}</Text>
        <Text style={styles.reportIdText}>VIN: {model.vin}</Text>
        <Text style={{ fontSize: 7, color: "#64748b" }}>Data zapytania: {model.createdAtFormatted}</Text>
      </View>
    </View>
  );
}

function PdfFooter() {
  const printTimestamp = new Date().toLocaleString("pl-PL");
  return (
    <View style={styles.footer} fixed>
      <Text>IzzyCheck © 2026 | Wydruk: {printTimestamp} | Wersja generatora: v{pkg.version || "0.1.0"}</Text>
      <Text render={({ pageNumber, totalPages }) => `Strona ${pageNumber} z ${totalPages}`} />
    </View>
  );
}

function PdfRightFrontSvg({ claimItem }: { claimItem: ReportPdfClaimItem }) {
  const rfMarkers = claimItem.presentation.markers.filter((m) => m.rf3qAnchor);
  const template = claimItem.presentation.template;
  const jpgFileName = template.assetFrontPdfJpg || "sedan-rf3q.jpg";
  const imagePath = path.join(process.cwd(), "public", "vehicles", "pdf", jpgFileName);
  const hasImage = fs.existsSync(imagePath);

  if (!hasImage) {
    console.warn(`[PDF Engine] Warning: Vehicle image background not found at ${imagePath}. Falling back to vector schema.`);
  }

  return (
    <View style={{ width: "100%", height: 80, position: "relative", backgroundColor: "#ffffff" }}>
      {hasImage ? (
        <Image
          src={imagePath}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
        />
      ) : (
        <Svg viewBox="0 0 400 200" style={{ width: "100%", height: "100%" }}>
          <Path
            d="M 60 120 L 90 90 L 140 55 L 210 50 L 260 70 L 300 95 L 340 115 L 370 135 L 360 155 L 320 165 L 140 165 L 80 155 Z"
            fill="#cbd5e1"
            stroke="#475569"
            strokeWidth="2"
          />
          <Path d="M 145 60 L 205 55 L 255 75 L 215 95 L 155 95 Z" fill="#93c5fd" opacity="0.6" />
          <Circle cx="330" cy="155" r="14" fill="#334155" />
          <Circle cx="140" cy="155" r="13" fill="#334155" />
        </Svg>
      )}

      {/* Svg layer with marker circles and numbers overlay */}
      <Svg viewBox="0 0 400 200" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}>
        {rfMarkers.map((m) => {
          if (!m.rf3qAnchor) return null;
          return (
            <G key={`pdfrf-${m.id}`}>
              <Circle
                cx={m.rf3qAnchor.x}
                cy={m.rf3qAnchor.y}
                r={10}
                fill={m.colorHex}
                stroke="#ffffff"
                strokeWidth={1.5}
              />
              <Text
                x={m.rf3qAnchor.x}
                y={m.rf3qAnchor.y + 3}
                style={{ fontSize: 8, fontWeight: "bold", textAnchor: "middle" }}
                fill="#ffffff"
              >
                {String(m.markerIndex)}
              </Text>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

function PdfLeftRearSvg({ claimItem }: { claimItem: ReportPdfClaimItem }) {
  const lrMarkers = claimItem.presentation.markers.filter((m) => m.lr3qAnchor);
  const template = claimItem.presentation.template;
  const jpgFileName = template.assetBackPdfJpg || "sedan-lr3q.jpg";
  const imagePath = path.join(process.cwd(), "public", "vehicles", "pdf", jpgFileName);
  const hasImage = fs.existsSync(imagePath);

  if (!hasImage) {
    console.warn(`[PDF Engine] Warning: Vehicle image background not found at ${imagePath}. Falling back to vector schema.`);
  }

  return (
    <View style={{ width: "100%", height: 80, position: "relative", backgroundColor: "#ffffff" }}>
      {hasImage ? (
        <Image
          src={imagePath}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
        />
      ) : (
        <Svg viewBox="0 0 400 200" style={{ width: "100%", height: "100%" }}>
          <Path
            d="M 50 135 L 70 115 L 115 85 L 160 55 L 220 50 L 270 70 L 330 95 L 350 120 L 330 155 L 260 165 L 90 165 Z"
            fill="#cbd5e1"
            stroke="#475569"
            strokeWidth="2"
          />
          <Path d="M 125 85 L 165 60 L 215 55 L 250 80 L 175 95 Z" fill="#93c5fd" opacity="0.6" />
          <Circle cx="110" cy="155" r="14" fill="#334155" />
          <Circle cx="290" cy="155" r="13" fill="#334155" />
        </Svg>
      )}

      {/* Svg layer with marker circles and numbers overlay */}
      <Svg viewBox="0 0 400 200" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}>
        {lrMarkers.map((m) => {
          if (!m.lr3qAnchor) return null;
          return (
            <G key={`pdflr-${m.id}`}>
              <Circle
                cx={m.lr3qAnchor.x}
                cy={m.lr3qAnchor.y}
                r={10}
                fill={m.colorHex}
                stroke="#ffffff"
                strokeWidth={1.5}
              />
              <Text
                x={m.lr3qAnchor.x}
                y={m.lr3qAnchor.y + 3}
                style={{ fontSize: 8, fontWeight: "bold", textAnchor: "middle" }}
                fill="#ffffff"
              >
                {String(m.markerIndex)}
              </Text>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

function PdfUnderbodySvg({ claimItem }: { claimItem: ReportPdfClaimItem }) {
  const ubMarkers = claimItem.presentation.markers.filter((m) => m.underbodyAnchor || m.primaryCategory === "UNDERBODY");

  return (
    <Svg viewBox="0 0 400 200" style={{ width: "100%", height: 100 }}>
      <Rect x="40" y="20" width="320" height="160" rx="25" fill="#f8fafc" stroke="#8b5cf6" strokeWidth="2" />
      <Line x1="90" y1="10" x2="90" y2="190" stroke="#cbd5e1" strokeWidth="4" />
      <Line x1="310" y1="10" x2="310" y2="190" stroke="#cbd5e1" strokeWidth="4" />
      <Rect x="75" y="5" width="30" height="25" rx="4" fill="#334155" />
      <Rect x="75" y="170" width="30" height="25" rx="4" fill="#334155" />
      <Rect x="295" y="5" width="30" height="25" rx="4" fill="#334155" />
      <Rect x="295" y="170" width="30" height="25" rx="4" fill="#334155" />
      <Rect x="140" y="50" width="120" height="100" rx="10" fill="#ede9fe" stroke="#8b5cf6" strokeWidth="1.5" strokeDasharray="4 2" />
      <Text x="200" y="105" style={{ fontSize: 11, fontWeight: "bold" }} fill="#6b21a8">
        SCHEMAT PODWOZIA
      </Text>

      {ubMarkers.map((m) => {
        const anchor = m.underbodyAnchor || { x: 200, y: 100 };
        return (
          <G key={`pdfub-${m.id}`}>
            <Circle cx={anchor.x} cy={anchor.y} r={9} fill={m.colorHex} />
            <Text
              x={anchor.x}
              y={anchor.y + 3}
              style={{ fontSize: 8, fontWeight: "bold" }}
              fill="#ffffff"
            >
              {String(m.markerIndex)}
            </Text>
          </G>
        );
      })}
    </Svg>
  );
}
