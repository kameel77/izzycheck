import { readFileSync } from "node:fs";

/** Odpowiedzi Audatex ze spike'a (VIN zanonimizowany: w XML-ach nie ma VIN, nazwy plików są modelowe). */
export function loadFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

export const FIXTURE_CARS = ["kia-sportage", "bmw-420d", "vw-arteon", "renault-arkana-hev", "vw-id3"] as const;
export type FixtureCar = (typeof FIXTURE_CARS)[number];

/** Syntetyczny VIN (bez I/O/Q) ze wskazanym znakiem roku modelowego na pozycji 10. */
export function syntheticVin(yearChar = "K"): string {
  return `ZZZZZZZZZ${yearChar}0000000`;
}
