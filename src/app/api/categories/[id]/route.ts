import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    // Vérifier que l'utilisateur est super admin
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true }
    })

    if (user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Accès non autorisé' }, { status: 403 })
    }

    const { id } = await params
    const categoryId = id

    // Vérifier que la catégorie existe
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      include: {
        formations: true,
        subCategories: true
      }
    })

    if (!category) {
      return NextResponse.json({ error: 'Catégorie introuvable' }, { status: 404 })
    }

    // Vérifier s'il y a des formations associées
    if (category.formations.length > 0) {
      return NextResponse.json({ 
        error: `Impossible de supprimer cette catégorie car elle contient ${category.formations.length} formation(s)` 
      }, { status: 409 })
    }

    // Supprimer d'abord les sous-catégories
    if (category.subCategories.length > 0) {
      await prisma.subCategory.deleteMany({
        where: { categoryId: categoryId }
      })
    }

    // Supprimer la catégorie
    await prisma.category.delete({
      where: { id: categoryId }
    })

    return NextResponse.json({
      message: 'Catégorie supprimée avec succès'
    })

  } catch (error) {
    console.error('Erreur suppression catégorie:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  } finally {
    await prisma.$disconnect()
  }
} 