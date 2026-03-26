import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    // Seuls les consultants et admins peuvent marquer une consultation comme terminée
    if (!['CONSULTANT', 'ADMIN'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const body = await request.json()
    const { appointmentId, notes } = body

    if (!appointmentId) {
      return NextResponse.json({ 
        error: 'ID de consultation requis' 
      }, { status: 400 })
    }

    // Vérifier que la consultation existe et appartient au consultant
    const appointment = await prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        consultantId: session.user.id,
        status: { in: ['CONFIRMED', 'ASSIGNED'] }
      },
      include: {
        user: {
          select: { id: true, name: true, email: true }
        },
        company: {
          select: { id: true, name: true }
        }
      }
    })

    if (!appointment) {
      return NextResponse.json({ 
        error: 'Consultation non trouvée ou déjà terminée' 
      }, { status: 404 })
    }

    // Marquer la consultation comme terminée
    const updatedAppointment = await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: 'COMPLETED',
        notes: notes || appointment.notes,
        updatedAt: new Date()
      }
    })

    // Créer une notification pour l'employé (demande de feedback)
    try {
      await prisma.notification.create({
        data: {
          userId: appointment.user.id,
          type: 'FEEDBACK_REQUEST',
          title: 'Évaluez votre consultation',
          message: `Votre consultation "${appointment.title}" s'est bien terminée. Prenez quelques minutes pour évaluer votre expérience et nous aider à améliorer nos services.`,
          data: {
            appointmentId: appointment.id,
            consultantName: session.user.name || 'Consultant',
            appointmentTitle: appointment.title
          }
        }
      })
    } catch (notificationError) {
      console.error('Erreur création notification:', notificationError)
      // Continue même si la notification échoue
    }

    // Créer une notification pour l'admin (optionnel)
    try {
      const admins = await prisma.user.findMany({
        where: { role: 'SUPER_ADMIN' },
        select: { id: true }
      })

      const adminNotifications = admins.map(admin => ({
        userId: admin.id,
        type: 'CONSULTATION_COMPLETED',
        title: 'Consultation terminée',
        message: `La consultation "${appointment.title}" avec ${appointment.user.name} (${appointment.company.name}) a été marquée comme terminée.`,
        data: {
          appointmentId: appointment.id,
          consultantId: session.user.id,
          clientName: appointment.user.name,
          companyName: appointment.company.name
        }
      }))

      if (adminNotifications.length > 0) {
        await prisma.notification.createMany({
          data: adminNotifications
        })
      }
    } catch (adminNotificationError) {
      console.error('Erreur notifications admin:', adminNotificationError)
    }

    // Programmer un rappel de feedback après 24h si pas de retour
    // (Ici on pourrait utiliser un système de tâches comme Agenda.js ou similaire)
    console.log(`Rappel programmé pour ${appointment.user.email} dans 24h`)

    return NextResponse.json({
      success: true,
      message: 'Consultation marquée comme terminée',
      appointment: {
        id: updatedAppointment.id,
        status: updatedAppointment.status,
        completedAt: updatedAppointment.updatedAt,
        clientName: appointment.user.name,
        title: appointment.title
      }
    })

  } catch (error) {
    console.error('Erreur finalisation consultation:', error)
    return NextResponse.json(
      { error: 'Erreur serveur lors de la finalisation' },
      { status: 500 }
    )
  }
}

// GET: Récupérer les consultations terminées du consultant
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    if (session.user.role !== 'CONSULTANT') {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '10')

    const completedAppointments = await prisma.appointment.findMany({
      where: {
        consultantId: session.user.id,
        status: 'COMPLETED'
      },
      include: {
        user: {
          select: { id: true, name: true, email: true }
        },
        company: {
          select: { id: true, name: true }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      },
      take: limit
    })

    const formattedAppointments = completedAppointments.map(appointment => ({
      id: appointment.id,
      title: appointment.title,
      description: appointment.description,
      scheduledAt: appointment.scheduledAt,
      completedAt: appointment.updatedAt,
      duration: appointment.duration,
      notes: appointment.notes,
      client: {
        id: appointment.user.id,
        name: appointment.user.name,
        email: appointment.user.email
      },
      company: {
        id: appointment.company.id,
        name: appointment.company.name
      }
    }))

    return NextResponse.json({
      appointments: formattedAppointments,
      total: completedAppointments.length
    })

  } catch (error) {
    console.error('Erreur récupération consultations terminées:', error)
    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    )
  }
} 