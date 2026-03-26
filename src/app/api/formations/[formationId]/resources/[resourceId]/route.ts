import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ formationId: string; resourceId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id || session.user.role !== "FORMATEUR") {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    const { formationId, resourceId } = await params;

    // Vérifier que la formation appartient au formateur
    const formation = await prisma.formation.findFirst({
      where: {
        id: formationId,
        authorId: session.user.id,
      },
    });

    if (!formation) {
      return NextResponse.json({ error: "Formation non trouvée" }, { status: 404 });
    }

    // Vérifier que la ressource existe et appartient à cette formation
    const resource = await prisma.resource.findFirst({
      where: {
        id: resourceId,
        formationId: formationId,
      },
    });

    if (!resource) {
      return NextResponse.json({ error: "Ressource non trouvée" }, { status: 404 });
    }

    // Supprimer la ressource
    await prisma.resource.delete({
      where: {
        id: resourceId,
      },
    });

    return NextResponse.json({ message: "Ressource supprimée avec succès" });
  } catch (error) {
    console.error("Erreur lors de la suppression de la ressource:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
} 