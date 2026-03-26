import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createSectionSchema = z.object({
  title: z.string().min(2, "Le titre doit contenir au moins 2 caractères"),
  description: z.string().optional(),
  orderIndex: z.number().optional(),
  isPublished: z.boolean().default(false),
  isFree: z.boolean().default(false),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ formationId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: "Non autorisé" },
        { status: 401 }
      );
    }

    if (session.user.role !== "FORMATEUR") {
      return NextResponse.json(
        { error: "Accès interdit" },
        { status: 403 }
      );
    }

    const { formationId } = await params;
    const body = await request.json();
    const validatedData = createSectionSchema.parse(body);

    // Vérifier que la formation appartient au formateur
    const formation = await prisma.formation.findFirst({
      where: {
        id: formationId,
        authorId: session.user.id,
      },
      include: {
        sections: {
          orderBy: { orderIndex: "desc" },
          take: 1,
        },
      },
    });

    if (!formation) {
      return NextResponse.json(
        { error: "Formation non trouvée" },
        { status: 404 }
      );
    }

    // Calculer l'index d'ordre automatiquement si non fourni
    const nextOrderIndex = validatedData.orderIndex ?? 
      ((formation.sections[0]?.orderIndex ?? 0) + 1);

    // Créer la section
    const section = await prisma.section.create({
      data: {
        title: validatedData.title,
        description: validatedData.description,
        isPublished: validatedData.isPublished,
        isFree: validatedData.isFree,
        orderIndex: nextOrderIndex,
        formationId: formationId,
      },
    });

    return NextResponse.json(section);
  } catch (error) {
    console.error("Erreur lors de la création de la section:", error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Données invalides", details: error.errors },
        { status: 400 }
      );
    }

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

    if (!session?.user) {
      return NextResponse.json(
        { error: "Non autorisé" },
        { status: 401 }
      );
    }

    const { formationId } = await params;

    // Vérifier que l'utilisateur a accès à cette formation
    const formation = await prisma.formation.findFirst({
      where: {
        id: formationId,
        OR: [
          { authorId: session.user.id }, // Formateur propriétaire
          { isActive: true }, // Formation publique
        ],
      },
    });

    if (!formation) {
      return NextResponse.json(
        { error: "Formation non trouvée" },
        { status: 404 }
      );
    }

    // Récupérer les sections avec leurs leçons
    const sections = await prisma.section.findMany({
      where: {
        formationId: formationId,
      },
      include: {
        lessons: {
          orderBy: { orderIndex: "asc" },
        },
      },
      orderBy: { orderIndex: "asc" },
    });

    return NextResponse.json(sections);
  } catch (error) {
    console.error("Erreur lors de la récupération des sections:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
} 