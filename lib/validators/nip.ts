/**
 * Walidator numeru NIP (Numer Identyfikacji Podatkowej).
 * 
 * Reguły walidacji:
 * 1. Normalizacja: usunięcie spacji, myślników oraz opcjonalnego prefiksu kraju "PL".
 * 2. Długość: dokładnie 10 cyfr numerycznych.
 * 3. Odrzucenie wartości zdegenerowanych (np. same zera).
 * 4. Algorytm wagowy Ministerstwa Finansów: wagi [6, 5, 7, 2, 3, 4, 5, 6, 7].
 * 5. Suma iloczynów modulo 11 musi być równa cyfrze kontrolnej (10. cyfra).
 *    Reszta z dzielenia równa 10 czyni NIP nieprawidłowym.
 */

export interface NipValidationResult {
  isValid: boolean;
  normalizedNip: string;
  error?: string;
}

const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];

export function validateNip(input: unknown): NipValidationResult {
  if (typeof input !== "string") {
    return {
      isValid: false,
      normalizedNip: "",
      error: "NIP musi być ciągiem znaków.",
    };
  }

  // 1. Normalizacja: usunięcie białych znaków, myślników i prefiksu "PL"
  let clean = input.trim().toUpperCase().replace(/[\s-]/g, "");
  if (clean.startsWith("PL")) {
    clean = clean.slice(2);
  }

  // 2. Format: dokładnie 10 cyfr
  if (!/^\d{10}$/.test(clean)) {
    return {
      isValid: false,
      normalizedNip: clean,
      error: "NIP musi składać się z dokładnie 10 cyfr.",
    };
  }

  // 3. Wykluczenie ciągów zdegenerowanych (np. same zera)
  if (/^0+$/.test(clean)) {
    return {
      isValid: false,
      normalizedNip: clean,
      error: "NIP nie może składać się z samych zer.",
    };
  }

  // 4. Obliczenie sumy kontrolnej
  const digits = clean.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += digits[i] * NIP_WEIGHTS[i];
  }

  const checksum = sum % 11;

  // Reszta równa 10 jest zabroniona
  if (checksum === 10) {
    return {
      isValid: false,
      normalizedNip: clean,
      error: "Nieprawidłowa suma kontrolna NIP (reszta 10).",
    };
  }

  const lastDigit = digits[9];
  if (checksum !== lastDigit) {
    return {
      isValid: false,
      normalizedNip: clean,
      error: "Błędna cyfra kontrolna NIP.",
    };
  }

  return {
    isValid: true,
    normalizedNip: clean,
  };
}
