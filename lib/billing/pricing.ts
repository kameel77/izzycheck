// Type-only Prisma imports: this module is also used from client components (nothing from @prisma/client reaches the bundle).
import type { CreditType } from "@prisma/client";

export const MAX_CART_LINES = 20;
export const MAX_LINE_QUANTITY = 100;

export interface PricingPackage {
  id: string;
  name: string;
  creditType: CreditType;
  credits: number;
  priceNetGrosze: number;
  vatRate: number;
}

export type CartPackage = PricingPackage & { isActive: boolean };

/** Mirrors OrderItem (without id/orderId) so lines can be stored directly. */
export interface PricedLine {
  packageId: string;
  packageName: string;
  creditType: CreditType;
  creditsPerPackage: number;
  quantity: number;
  unitNetGrosze: number;
  unitGrossGrosze: number;
  vatRate: number;
  lineNetGrosze: number;
  lineVatGrosze: number;
  lineGrossGrosze: number;
}

export type PricedCart =
  | { lines: PricedLine[]; totalNetGrosze: number; totalVatGrosze: number; totalGrossGrosze: number }
  | { error: string };

/** Per-unit gross price; VAT is rounded half up to a whole grosz. */
export function unitGrossFromNet(unitNetGrosze: number, vatRate: number): number {
  const unitVat = Math.floor((unitNetGrosze * vatRate + 50) / 100);
  return unitNetGrosze + unitVat;
}

export function priceLine(pkg: PricingPackage, quantity: number): PricedLine {
  const unitNetGrosze = pkg.priceNetGrosze;
  const unitGrossGrosze = unitGrossFromNet(unitNetGrosze, pkg.vatRate);
  const lineNetGrosze = unitNetGrosze * quantity;
  const lineGrossGrosze = unitGrossGrosze * quantity;
  return {
    packageId: pkg.id,
    packageName: pkg.name,
    creditType: pkg.creditType,
    creditsPerPackage: pkg.credits,
    quantity,
    unitNetGrosze,
    unitGrossGrosze,
    vatRate: pkg.vatRate,
    lineNetGrosze,
    lineVatGrosze: lineGrossGrosze - lineNetGrosze,
    lineGrossGrosze,
  };
}

function isValidQuantity(quantity: unknown): quantity is number {
  return typeof quantity === "number" && Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_LINE_QUANTITY;
}

/** Prices a cart from trusted package data. Duplicate packageIds are merged before limits are applied. */
export function priceCart(packages: CartPackage[], items: Array<{ packageId: string; quantity: number }>): PricedCart {
  if (!Array.isArray(items) || items.length === 0) {
    return { error: "Koszyk jest pusty." };
  }

  const quantities = new Map<string, number>();
  for (const item of items) {
    if (!isValidQuantity(item?.quantity)) {
      return { error: "Nieprawidłowa ilość (1–100)." };
    }
    quantities.set(item.packageId, (quantities.get(item.packageId) ?? 0) + item.quantity);
  }

  if (quantities.size > MAX_CART_LINES) {
    return { error: "Koszyk może mieć maks. 20 pozycji." };
  }

  const byId = new Map(packages.map((p) => [p.id, p]));
  const lines: PricedLine[] = [];
  for (const [packageId, quantity] of quantities) {
    if (!isValidQuantity(quantity)) {
      return { error: "Nieprawidłowa ilość (1–100)." };
    }
    const pkg = byId.get(packageId);
    if (!pkg || !pkg.isActive) {
      return { error: "Pakiet jest niedostępny." };
    }
    lines.push(priceLine(pkg, quantity));
  }

  return {
    lines,
    totalNetGrosze: lines.reduce((sum, l) => sum + l.lineNetGrosze, 0),
    totalVatGrosze: lines.reduce((sum, l) => sum + l.lineVatGrosze, 0),
    totalGrossGrosze: lines.reduce((sum, l) => sum + l.lineGrossGrosze, 0),
  };
}
