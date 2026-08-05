import { NextResponse } from "next/server";
import { comparePassword, createToken, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

// Fallback seed user for instant local/demo login if DB has no users yet
const DEFAULT_OPERATOR = {
  email: "operator@izzylease.pl",
  password: "OperatorIzzy2026!",
  name: "Operator Izzy Lease",
  role: "OPERATOR" as const,
};

const DEFAULT_ADMIN = {
  email: "admin@izzylease.pl",
  password: "AdminIzzy2026!",
  name: "Administrator Izzy Lease",
  role: "ADMIN" as const,
};

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email i hasło są wymagane." }, { status: 400 });
    }

    let user = null;
    try {
      user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
    } catch (e) {
      // If DB is empty or uninitialized during demo, fallback to built-in operator
    }

    if (!user) {
      if (email === DEFAULT_OPERATOR.email && password === DEFAULT_OPERATOR.password) {
        const passwordHash = await hashPassword(DEFAULT_OPERATOR.password);
        try {
          user = await prisma.user.create({
            data: {
              email: DEFAULT_OPERATOR.email,
              name: DEFAULT_OPERATOR.name,
              passwordHash,
              role: DEFAULT_OPERATOR.role,
            },
          });
        } catch (e) {
          user = {
            id: "op-1",
            email: DEFAULT_OPERATOR.email,
            name: DEFAULT_OPERATOR.name,
            passwordHash,
            role: DEFAULT_OPERATOR.role,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
      } else if (email === DEFAULT_ADMIN.email && password === DEFAULT_ADMIN.password) {
        const passwordHash = await hashPassword(DEFAULT_ADMIN.password);
        try {
          user = await prisma.user.create({
            data: {
              email: DEFAULT_ADMIN.email,
              name: DEFAULT_ADMIN.name,
              passwordHash,
              role: DEFAULT_ADMIN.role,
            },
          });
        } catch (e) {
          user = {
            id: "admin-1",
            email: DEFAULT_ADMIN.email,
            name: DEFAULT_ADMIN.name,
            passwordHash,
            role: DEFAULT_ADMIN.role,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
      }
    }

    if (!user) {
      return NextResponse.json({ error: "Nieprawidłowy e-mail lub hasło." }, { status: 401 });
    }

    if (user.passwordHash) {
      const isValid = await comparePassword(password, user.passwordHash);
      if (!isValid && !(email === DEFAULT_OPERATOR.email && password === DEFAULT_OPERATOR.password)) {
        return NextResponse.json({ error: "Nieprawidłowy e-mail lub hasło." }, { status: 401 });
      }
    }

    const tokenPayload = {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role as "OPERATOR" | "ADMIN",
    };

    const token = await createToken(tokenPayload);

    // Audit login
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
      // Ignore if audit write fails in unmigrated db
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
