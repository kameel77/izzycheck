/** Pozycja wyposażenia 1:1 z Audatex (bez mapowania na cechy/ID DAT; to robi mamygo po swojej stronie). */
export interface ExternalEquipmentItem {
  label: string;
  id: string;
}

/**
 * Kontrakt odpowiedzi POST /api/v1/vehicles/vin-identification.
 * Wszystkie wartości skalarne to string albo null (liczby jako stringi, ułamki z kropką).
 */
export interface ExternalVinIdentification {
  vin: string;
  make: string | null;
  model: string | null;
  manufacturerName: string | null;
  constructionTime: string | null;
  constructionYear: string | null;
  body: string | null;
  subModelName: string | null;
  doorsCount: string | null;
  cubicCapacity: string | null;
  powerKw: string | null;
  powerHp: string | null;
  drive: string | null;
  transmission: string | null;
  gearsCount: string | null;
  fuelType: string | null;
  tankVolume: string | null;
  originalTireSizeAxle1: string | null;
  batteryCapacityKWh: string | null;
  minimumTrunkCapacityL: string | null;
  productType: string | null;
  maxLoadKg: string | null;
  speedMax: string | null;
  consumptionInTown: string | null;
  consumptionOutOfTown: string | null;
  co2Emission: string | null;
  length: string | null;
  width: string | null;
  height: string | null;
  axlesCount: string | null;
  wheelBase: string | null;
  airbagsCount: string | null;
  seatsCount: string | null;
  carFeaturesBasicWithId: ExternalEquipmentItem[];
  carFeaturesAdditionalWithId: ExternalEquipmentItem[];
}
