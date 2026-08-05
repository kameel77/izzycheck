import { NextResponse } from "next/server";
import { comparePassword, createToken, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email i hasło są wymagane." }, { status: 400 });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    // Query user strictly from Database
    let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    // Initial admin seeding from env if DB is empty and ENV credentials match
    if (!user && process.env.INITIAL_ADMIN_EMAIL && process.env.INITIAL_ADMIN_PASSWORD) {
      const initEmail = process.env.INITIAL_ADMIN_EMAIL.toLowerCase().trim();
      if (normalizedEmail === initEmail && password === process.env.INITIAL_ADMIN_PASSWORD) {
        const passwordHash = await hashPassword(process.env.INITIAL_ADMIN_PASSWORD);
        user = await prisma.user.create({
          data: {
            email: initEmail,
            name: "Administrator Izzy Lease",
            passwordHash,
            role: "ADMIN",
          },
        });
      }
    }

    if (!user) {
      return NextResponse.json({ error: "Nieprawidłowy e-mail lub hasło." }, { status: 401 });
    }

    const isValid = await comparePassword(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json({ error: "Nieprawidłowy e-mail lub hasło." }, { status: 401 });
    }

    const tokenPayload = {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role as "OPERATOR" | "ADMIN",
    };

    const token = await createToken(tokenPayload);

    // Audit login event
    try {
      await prisma.auditEvent.create({
        data: {
          userId: user.id,
          userEmail: user.email,
          action: "USER_LOGIN",
          resource: "AUTH",
          metadataJson: JSON.stringify({ timestamp: new Date().toISOString() }),
        },
      });
    } catch (e) {
      console.error("Błąd zapisu logu audytowego logowania:", e);
    }

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });

    response.cookies.set("izzycheck_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24, // 24h
      path: "/",
    });

    return response;
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Błąd serwera podczas logowania." }, { status: 500 });
  }
}
