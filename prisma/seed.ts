import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const estate = await prisma.estate.upsert({
    where: { code: "DEMO" },
    update: {},
    create: { name: "Demo Estate", code: "DEMO" },
  });

  await prisma.unit.upsert({
    where: { id: "demo-unit-1" },
    update: {},
    create: {
      id: "demo-unit-1",
      unitNumber: "12A",
      estateId: estate.id,
      residentPhone: "27821234567",
    },
  });

  await prisma.gate.upsert({
    where: { id: "demo-gate-1" },
    update: {},
    create: { id: "demo-gate-1", name: "Main Boom North", estateId: estate.id },
  });

  console.log("Seeded estate=%s unit=demo-unit-1 gate=demo-gate-1", estate.id);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
