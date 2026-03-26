import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createLessonSchema = z.object({
  title: z.string().min(2, "Le titre doit contenir au moins 2 caractères"),
  description: z.string().optional(),
  type: z.enum(["VIDEO", "TEXT", "QUIZ", "DOCUMENT"]).default("VIDEO"),
  duration: z.number().min(0).default(0),
  orderIndex: z.number().optional(),
  isPublished: z.boolean().default(false),
  isFree: z.boolean().default(false),
  videoUrl: z.string().optional(),
  muxAssetId: z.string().optional(),
  muxPlaybackId: z.string().optional(),
  quizData: z.any().optional(), // Données du quiz
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sectionId: string }> }
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

    // Attendre les paramètres
    const { sectionId } = await params;

    const body = await request.json();
    const validatedData = createLessonSchema.parse(body);

    // Vérifier que la section appartient au formateur
    const section = await prisma.section.findFirst({
      where: {
        id: sectionId,
        formation: {
          authorId: session.user.id,
        },
      },
      include: {
        lessons: {
          orderBy: { orderIndex: "desc" },
          take: 1,
        },
      },
    });

    if (!section) {
      return NextResponse.json(
        { error: "Section non trouvée" },
        { status: 404 }
      );
    }

    // Calculer l'index d'ordre automatiquement si non fourni
    const nextOrderIndex = validatedData.orderIndex ?? 
      ((section.lessons[0]?.orderIndex ?? 0) + 1);

    // Créer la leçon
    const lesson = await prisma.lesson.create({
      data: {
        title: validatedData.title,
        description: validatedData.description,
        type: validatedData.type,
        duration: validatedData.duration,
        isPublished: validatedData.isPublished,
        isFree: validatedData.isFree,
        videoUrl: validatedData.videoUrl,
        muxAssetId: validatedData.muxAssetId,
        muxPlaybackId: validatedData.muxPlaybackId,
        content: validatedData.quizData ? JSON.stringify(validatedData.quizData) : undefined,
        orderIndex: nextOrderIndex,
        sectionId: sectionId,
      },
    });

    return NextResponse.json(lesson);
  } catch (error) {
    console.error("Erreur lors de la création de la leçon:", error);
    
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
  { params }: { params: Promise<{ sectionId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: "Non autorisé" },
        { status: 401 }
      );
    }

    const { sectionId } = await params;

    // Vérifier l'accès à la section
    const section = await prisma.section.findFirst({
      where: {
        id: sectionId,
        OR: [
          {
            formation: {
              authorId: session.user.id, // Formateur propriétaire
            },
          },
          {
            formation: {
              isActive: true, // Formation publique
            },
          },
        ],
      },
    });

    if (!section) {
      return NextResponse.json(
        { error: "Section non trouvée" },
        { status: 404 }
      );
    }

    // Récupérer les leçons
    const lessons = await prisma.lesson.findMany({
      where: {
        sectionId: sectionId,
      },
      orderBy: { orderIndex: "asc" },
    });

    return NextResponse.json(lessons);
  } catch (error) {
    console.error("Erreur lors de la récupération des leçons:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
} 