import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ formationId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id || session.user.role !== "FORMATEUR") {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    const { formationId } = await params;
    const body = await request.json();
    const { name, description, fileUrl, fileSize, fileType } = body;

    if (!name || !fileUrl) {
      return NextResponse.json({ error: "Nom et URL du fichier requis" }, { status: 400 });
    }

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

    // Créer la ressource
    const resource = await prisma.resource.create({
      data: {
        name,
        description: description || null,
        fileUrl,
        fileSize: fileSize || null,
        fileType: fileType || null,
        formationId,
      },
    });

    return NextResponse.json(resource);
  } catch (error) {
    console.error("Erreur lors de la création de la ressource:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ formationId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    const { formationId } = await params;

    // Vérifier que la formation appartient au formateur ou que l'utilisateur y a accès
    const formation = await prisma.formation.findFirst({
      where: {
        id: formationId,
        OR: [
          { authorId: session.user.id },
          { 
            userFormations: {
              some: {
                userId: session.user.id,
              },
            },
          },
        ],
      },
    });

    if (!formation) {
      return NextResponse.json({ error: "Formation non trouvée" }, { status: 404 });
    }

    // Récupérer les ressources
    const resources = await prisma.resource.findMany({
      where: {
        formationId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json(resources);
  } catch (error) {
    console.error("Erreur lors de la récupération des ressources:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
} 