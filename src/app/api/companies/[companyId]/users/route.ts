import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { companyId } = await params

    // Vérifier les permissions
    if (session.user.role !== 'SUPER_ADMIN' && session.user.companyId !== companyId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    // Récupérer les utilisateurs de l'entreprise
    const users = await prisma.user.findMany({
      where: {
        companyId: companyId
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        emailVerified: true,
        companyId: true,
        company: {
          select: {
            name: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    // Formatter les données pour le frontend
    const formattedUsers = users.map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.emailVerified ? 'ACTIVE' : 'PENDING',
      lastActive: null, // À implémenter plus tard avec un système de tracking
      joinedAt: user.createdAt.toISOString(),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      companyId: user.companyId,
      formationProgress: 0, // À calculer plus tard
      completedFormations: 0 // À calculer plus tard
    }))

    return NextResponse.json({
      users: formattedUsers,
      total: formattedUsers.length
    })

  } catch (error) {
    console.error('Erreur lors de la récupération des utilisateurs:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
} 