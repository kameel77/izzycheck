import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const operatorPassword = await bcrypt.hash("OperatorIzzy2026!", 10);
  const adminPassword = await bcrypt.hash("AdminIzzy2026!", 10);

  const operator = await prisma.user.upsert({
    where: { email: "operator@izzylease.pl" },
    update: {},
    create: {
      email: "operator@izzylease.pl",
      name: "Operator Izzy Lease",
      passwordHash: operatorPassword,
      role: "OPERATOR",
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: "admin@izzylease.pl" },
    update: {},
    create: {
      email: "admin@izzylease.pl",
      name: "Administrator Izzy Lease",
      passwordHash: adminPassword,
      role: "ADMIN",
    },
  });

  console.log("Seeded default users successfully:");
  console.log("Operator:", operator.email);
  console.log("Admin:", admin.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
