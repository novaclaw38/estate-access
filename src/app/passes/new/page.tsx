import { prisma } from "@/lib/prisma";
import PassRequestForm from "@/components/PassRequestForm";

// Unit list is live estate data — never prerender this at build time.
export const dynamic = "force-dynamic";

export default async function NewPassPage() {
  const units = await prisma.unit.findMany({
    include: { estate: true },
    orderBy: { unitNumber: "asc" },
  });

  const options = units.map((u) => ({ id: u.id, label: `${u.estate.name} — Unit ${u.unitNumber}` }));

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <PassRequestForm units={options} />
    </main>
  );
}
