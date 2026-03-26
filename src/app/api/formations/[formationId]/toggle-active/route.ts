import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Fonction pour créer une notification
async function createNotification(
  userId: string, 
  type: string, 
  title: string, 
  message: string, 
  data?: any
) {
  try {
    await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
        data: data ? JSON.stringify(data) : undefined,
        isRead: false
      }
    })
    console.log(`✅ Notification créée pour ${userId}: ${title}`)
  } catch (error) {
    console.error('❌ Erreur création notification:', error)
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ formationId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    // Seuls les SUPER_ADMIN peuvent activer/désactiver des formations
    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const { formationId } = await params
    const body = await request.json()
    const { isActive } = body

    if (typeof isActive !== 'boolean') {
      return NextResponse.json({ error: 'isActive doit être un booléen' }, { status: 400 })
    }

    // Vérifier que la formation existe et récupérer l'auteur
    const formation = await prisma.formation.findUnique({
      where: { id: formationId },
      include: {
        author: {
          select: { id: true, name: true, email: true }
        }
      }
    })

    if (!formation) {
      return NextResponse.json({ error: 'Formation non trouvée' }, { status: 404 })
    }

    // Mettre à jour le statut d'activation
    const updatedFormation = await prisma.formation.update({
      where: { id: formationId },
      data: { isActive }
    })

    // Envoyer une notification au formateur
    if (formation.author?.id) {
      const actionText = isActive ? 'activée' : 'désactivée'
      const emoji = isActive ? '🟢' : '🔴'
      const explanation = isActive 
        ? 'Votre formation est maintenant visible et accessible aux utilisateurs.' 
        : 'Votre formation a été temporairement désactivée pour maintenance ou révision.'

      await createNotification(
        formation.author.id,
        isActive ? 'formation_activated' : 'formation_deactivated',
        `${emoji} Formation ${actionText}`,
        `Votre formation "${formation.title}" a été ${actionText} par l'administration. ${explanation}`,
        {
          formationId: formation.id,
          formationTitle: formation.title,
          action: actionText,
          isActive: isActive,
          adminName: session.user.name || 'Administration'
        }
      )
    }

    return NextResponse.json({
      message: `Formation ${isActive ? 'activée' : 'désactivée'} avec succès`,
      formation: {
        id: updatedFormation.id,
        title: updatedFormation.title,
        isActive: updatedFormation.isActive
      }
    })

  } catch (error) {
    console.error('Erreur lors de la modification du statut:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
} 