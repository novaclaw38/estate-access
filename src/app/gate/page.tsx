import Link from "next/link";
import { prisma } from "@/lib/prisma";

// Gate list is live estate data — never prerender this at build time.
export const dynamic = "force-dynamic";

export default async function GateIndexPage() {
  const gates = await prisma.gate.findMany({ include: { estate: true }, orderBy: { name: "asc" } });

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold">Select Your Gate</h1>
      <p className="text-sm text-slate-400 mb-2">
        Tablets should bookmark or install directly to their assigned gate below.
      </p>
      <div className="flex flex-col gap-3 w-full max-w-sm">
        {gates.map((gate) => (
          <Link
            key={gate.id}
            href={`/gate/${gate.id}`}
            className="px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl font-semibold text-center hover:bg-slate-800 transition"
          >
            {gate.name}
            <span className="block text-xs text-slate-500 font-normal">{gate.estate.name}</span>
          </Link>
        ))}
        {gates.length === 0 && <p className="text-center text-slate-500 text-sm">No gates configured yet.</p>}
      </div>
    </main>
  );
}
