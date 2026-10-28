import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AudatexValuationAdapter } from "@/lib/audatex/valuation";
import { handleVinIdentification } from "@/lib/integrations/mamygo/service";

const valuationAdapter = new AudatexValuationAdapter();

export async function POST(req: Request) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // Zły JSON: walidacja zwróci 400 INVALID_REQUEST (po sprawdzeniu tokenu).
  }

  const result = await handleVinIdentification(
    { db: prisma, identify: (vin) => valuationAdapter.identifyVehicle(vin) },
    { authorization: req.headers.get("authorization"), body },
  );
  return NextResponse.json(result.body, { status: result.status, headers: result.headers });
}
