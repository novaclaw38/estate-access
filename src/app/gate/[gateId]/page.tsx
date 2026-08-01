import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import GuardGateDashboard from "@/components/GuardGateDashboard";

export const dynamic = "force-dynamic";

export default async function GatePage({ params }: { params: Promise<{ gateId: string }> }) {
  const { gateId } = await params;
  const gate = await prisma.gate.findUnique({ where: { id: gateId } });

  if (!gate) notFound();

  return <GuardGateDashboard gateId={gate.id} gateName={gate.name} />;
}
