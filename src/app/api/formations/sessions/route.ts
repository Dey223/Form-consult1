import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const formationId = searchParams.get('formationId')
    const month = searchParams.get('month') // Format: YYYY-MM
    const userId = session.user.id

    // Si formationId spécifique
    if (formationId) {
      // Vérifier que l'utilisateur a accès à cette formation
      const userFormation = await prisma.userFormation.findFirst({
        where: {
          userId: userId,
          formationId: formationId
        }
      })

      if (!userFormation) {
        return NextResponse.json({ error: 'Accès refusé à cette formation' }, { status: 403 })
      }

      // Récupérer les sessions de cette formation
      const sessions = await prisma.formationSession.findMany({
        where: {
          formationId: formationId,
          ...(month && {
            startDate: {
              gte: new Date(`${month}-01`),
              lt: new Date(`${month}-31`)
            }
          })
        },
        include: {
          formation: {
            select: {
              title: true,
              description: true
            }
          },
          instructor: {
            select: {
              name: true,
              email: true
            }
          },
          attendees: {
            select: {
              userId: true,
              isPresent: true
            }
          }
        },
        orderBy: {
          startDate: 'asc'
        }
      })

      return NextResponse.json({ sessions })
    }

    // Sinon, récupérer toutes les sessions des formations de l'utilisateur
    const userFormations = await prisma.userFormation.findMany({
      where: { userId: userId },
      select: { formationId: true }
    })

    const formationIds = userFormations.map(uf => uf.formationId)

    const sessions = await prisma.formationSession.findMany({
      where: {
        formationId: { in: formationIds },
        ...(month && {
          startDate: {
            gte: new Date(`${month}-01`),
            lt: new Date(`${month}-31`)
          }
        })
      },
      include: {
        formation: {
          select: {
            title: true,
            description: true,
            level: true
          }
        },
        instructor: {
          select: {
            name: true,
            email: true
          }
        },
        attendees: {
          select: {
            userId: true,
            isPresent: true
          }
        }
      },
      orderBy: {
        startDate: 'asc'
      }
    })

    // Ajouter des informations sur l'inscription de l'utilisateur
    const sessionsWithUserInfo = sessions.map(session => ({
      ...session,
      userAttendance: session.attendees.find(a => a.userId === userId) || null,
      availableSpots: session.maxAttendees - session.attendees.length
    }))

    return NextResponse.json({ sessions: sessionsWithUserInfo })

  } catch (error) {
    console.error('Erreur récupération sessions:', error)
    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const body = await request.json()
    const { sessionId, action } = body
    const userId = session.user.id

    if (action === 'register') {
      // S'inscrire à une session
      const formationSession = await prisma.formationSession.findUnique({
        where: { id: sessionId },
        include: { attendees: true }
      })

      if (!formationSession) {
        return NextResponse.json({ error: 'Session non trouvée' }, { status: 404 })
      }

      // Vérifier la capacité
      if (formationSession.attendees.length >= formationSession.maxAttendees) {
        return NextResponse.json({ error: 'Session complète' }, { status: 400 })
      }

      // Vérifier que l'utilisateur n'est pas déjà inscrit
      const existingAttendance = await prisma.sessionAttendance.findFirst({
        where: {
          sessionId: sessionId,
          userId: userId
        }
      })

      if (existingAttendance) {
        return NextResponse.json({ error: 'Déjà inscrit à cette session' }, { status: 400 })
      }

      // Vérifier que l'utilisateur a accès à la formation
      const userFormation = await prisma.userFormation.findFirst({
        where: {
          userId: userId,
          formationId: formationSession.formationId
        }
      })

      if (!userFormation) {
        return NextResponse.json({ error: 'Accès refusé à cette formation' }, { status: 403 })
      }

      // Créer l'inscription
      await prisma.sessionAttendance.create({
        data: {
          sessionId: sessionId,
          userId: userId,
          isConfirmed: true,
          registeredAt: new Date()
        }
      })

      return NextResponse.json({ message: 'Inscription réussie' })

    } else if (action === 'unregister') {
      // Se désinscrire d'une session
      await prisma.sessionAttendance.deleteMany({
        where: {
          sessionId: sessionId,
          userId: userId
        }
      })

      return NextResponse.json({ message: 'Désinscription réussie' })
    }

    return NextResponse.json({ error: 'Action non reconnue' }, { status: 400 })

  } catch (error) {
    console.error('Erreur gestion session:', error)
    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    )
  }
} 