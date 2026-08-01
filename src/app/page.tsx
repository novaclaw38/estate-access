import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-2xl font-bold">Estate Security Manager</h1>
      <div className="flex gap-4">
        <Link href="/passes/new" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold">
          Request Visitor Pass
        </Link>
      </div>
      <p className="text-sm text-slate-500">
        Guard tablets scan at /gate/[gateId] — see README for seeding a Gate record.
      </p>
    </main>
  );
}
