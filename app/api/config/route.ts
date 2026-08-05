import { NextResponse } from "next/server";

export async function GET() {
  const isMockMode = process.env.AUDATEX_MOCK_MODE === "true";
  return NextResponse.json({
    isMockMode,
    environment: process.env.NODE_ENV || "development",
  });
}
