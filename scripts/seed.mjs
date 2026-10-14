import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.INITIAL_ADMIN_EMAIL?.toLowerCase().trim();
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.log("No INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD provided. Skipping admin seed.");
    return;
  }

  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash,
      role: "ADMIN",
    },
    create: {
      email: adminEmail,
      name: "Administrator Izzy Lease",
      passwordHash,
      role: "ADMIN",
    },
  });

  console.log(`Initial admin user successfully configured for: ${admin.email}`);

  // Seed default Organization: Izzy Lease Sp. z o.o.
  const defaultOrg = await prisma.organization.upsert({
    where: { nip: "6871964402" },
    update: {
      name: "Izzy Lease Sp. z o.o.",
      street: "ul. Domaniewska 37",
      postalCode: "02-672",
      city: "Warszawa",
      country: "PL",
      billingEmail: "kontakt@izzylease.pl",
      isActive: true,
    },
    create: {
      name: "Izzy Lease Sp. z o.o.",
      nip: "6871964402",
      street: "ul. Domaniewska 37",
      postalCode: "02-672",
      city: "Warszawa",
      country: "PL",
      billingEmail: "kontakt@izzylease.pl",
      isActive: true,
    },
  });

  console.log(`Default organization configured: ${defaultOrg.name} (NIP: ${defaultOrg.nip})`);
}

main()
  .catch((e) => {
    console.error("Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
