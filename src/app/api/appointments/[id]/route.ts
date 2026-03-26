import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendConsultationApprovedEmail, sendConsultationRejectedEmail } from '@/lib/email'

// Fonction pour créer une notification de manière sécurisée
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
        data: data ? JSON.stringify(data) : null,
        isRead: false
      }
    })
  } catch (error) {
    console.error('Erreur création notification:', error)
    // Ne pas faire échouer la requête principale à cause d'une notification
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { id } = await params
    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: {
        user: true,
        consultant: true,
        company: true
      }
    })

    if (!appointment) {
      return NextResponse.json({ error: 'Consultation non trouvée' }, { status: 404 })
    }

    // Vérifier les autorisations
    const canView = 
      appointment.userId === session.user.id ||
      appointment.consultantId === session.user.id ||
      (session.user.role === 'ADMIN_ENTREPRISE' && session.user.companyId === appointment.companyId) ||
      session.user.role === 'SUPER_ADMIN'

    if (!canView) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
    }

    return NextResponse.json(appointment)

  } catch (error) {
    console.error('Erreur récupération consultation:', error)
    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const { action, status, notes, meetingUrl, consultantId } = body

    // Récupérer la consultation actuelle
    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: {
        user: true,
        consultant: true,
        company: true
      }
    })

    if (!appointment) {
      return NextResponse.json({ error: 'Consultation non trouvée' }, { status: 404 })
    }

    // Vérifier les autorisations
    const canModify = 
      (session.user.role === 'CONSULTANT' && session.user.id === appointment.consultantId) ||
      (session.user.role === 'ADMIN_ENTREPRISE' && session.user.companyId === appointment.companyId) ||
      session.user.role === 'SUPER_ADMIN'

    if (!canModify) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
    }

    // Mapper les actions vers les statuts
    let newStatus = status
    if (action) {
      switch (action) {
        case 'accept':
          newStatus = 'CONFIRMED'
          break
        case 'cancel':
          newStatus = 'CANCELED'
          break
        case 'assign':
          newStatus = 'ASSIGNED'
          break
        default:
          newStatus = status
      }
    }

    // Logique spéciale pour l'assignation de consultant
    if (consultantId && session.user.role === 'SUPER_ADMIN') {
      const consultant = await prisma.user.findUnique({
        where: { 
          id: consultantId,
          role: 'CONSULTANT'
        }
      })

      if (!consultant) {
        return NextResponse.json({ error: 'Consultant non trouvé' }, { status: 404 })
      }
    }

    // Gestion spéciale pour status COMPLETED - mettre à jour les quotas entreprise
    if (newStatus === 'COMPLETED' && body.actualDuration) {
      // Mettre à jour la durée de consultation utilisée de l'entreprise
      if (appointment.companyId) {
        const company = await prisma.company.findUnique({
          where: { id: appointment.companyId }
        })
        
        if (company) {
          // Commenté temporairement - le champ consultingHoursUsed n'existe pas encore dans le schéma
          // const newUsedHours = (company.consultingHoursUsed || 0) + Math.round(body.actualDuration / 60 * 100) / 100
          
          // await prisma.company.update({
          //   where: { id: appointment.companyId },
          //   data: { 
          //     consultingHoursUsed: newUsedHours 
          //   }
          // })
        }
      }
      
      // Mettre à jour les données du rendez-vous avec les infos de fin
      const updatedAppointment = await prisma.appointment.update({
        where: { id },
        data: {
          status: newStatus as any,
          meetingUrl: meetingUrl || appointment.meetingUrl,
          notes: notes || appointment.notes,
          duration: body.actualDuration, // Durée réelle en minutes
          completedAt: new Date()
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
          consultant: { select: { id: true, name: true, email: true } },
          company: { select: { id: true, name: true } }
        }
      })

      // Créer des notifications selon l'action
      await createNotification(
        appointment.userId,
        'consultation_completed',
        'Consultation terminée',
        `Votre consultation "${appointment.title}" est terminée. Merci de nous faire part de vos commentaires.`,
        { appointmentId: appointment.id }
      )

      // Notifier l'admin entreprise
      const adminEntrepriseCompleted = await prisma.user.findFirst({
        where: { 
          companyId: appointment.companyId,
          role: 'ADMIN_ENTREPRISE'
        }
      })
      
      if (adminEntrepriseCompleted) {
        await createNotification(
          adminEntrepriseCompleted.id,
          'consultation_completed',
          'Session de consulting terminée',
          `La consultation "${appointment.title}" de ${appointment.user.name} s'est terminée avec succès. Durée: ${body.actualDuration} minutes.`,
          { appointmentId: appointment.id, employeeName: appointment.user.name, duration: body.actualDuration }
        )
      }

      // Notifier les super admins
      const superAdminsCompleted = await prisma.user.findMany({
        where: { role: 'SUPER_ADMIN' }
      })
      
      for (const admin of superAdminsCompleted) {
        await createNotification(
          admin.id,
          'consultation_completed',
          'Session de consulting terminée',
          `La consultation "${appointment.title}" de ${appointment.company.name} est terminée. Durée: ${body.actualDuration} minutes.`,
          { appointmentId: appointment.id, companyName: appointment.company.name, duration: body.actualDuration }
        )
      }

      return NextResponse.json({
        message: 'Consultation mise à jour avec succès',
        appointment: updatedAppointment
      })
    } else {
      // Mise à jour normale
      const updatedAppointment = await prisma.appointment.update({
        where: { id },
        data: {
          status: newStatus as any,
          meetingUrl: meetingUrl || appointment.meetingUrl,
          notes: notes || appointment.notes,
          consultantId: consultantId || appointment.consultantId
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
          consultant: { select: { id: true, name: true, email: true } },
          company: { select: { id: true, name: true } }
        }
      })

      // Créer des notifications selon l'action
      if (newStatus) {
        switch (newStatus) {
          case 'ASSIGNED':
            if (consultantId) {
              await createNotification(
                consultantId,
                'consultation_assigned',
                'Nouvelle consultation assignée',
                `Une consultation "${appointment.title}" vous a été assignée par ${session.user.name}`,
                { appointmentId: appointment.id, scheduledAt: appointment.scheduledAt }
              )
            }
            
            await createNotification(
              appointment.userId,
              'consultation_assigned',
              'Consultant assigné à votre demande',
              `Un consultant a été assigné à votre demande "${appointment.title}". Vous recevrez bientôt une confirmation.`,
              { appointmentId: appointment.id }
            )

            // Notifier l'admin entreprise
            if (appointment.company) {
              const adminEntreprise = await prisma.user.findFirst({
                where: { 
                  companyId: appointment.companyId,
                  role: 'ADMIN_ENTREPRISE'
                }
              })
              
              if (adminEntreprise) {
                await createNotification(
                  adminEntreprise.id,
                  'consultation_assigned',
                  'Consultant assigné pour votre équipe',
                  `Un consultant a été assigné à la consultation "${appointment.title}" demandée par ${appointment.user.name}`,
                  { appointmentId: appointment.id, employeeName: appointment.user.name }
                )
              }
            }
            break

          case 'CONFIRMED':
            await createNotification(
              appointment.userId,
              'consultation_confirmed',
              'Consultation confirmée ✅',
              `Excellente nouvelle ! Votre consultation "${appointment.title}" a été confirmée. Préparez-vous pour votre session.`,
              { appointmentId: appointment.id, scheduledAt: appointment.scheduledAt }
            )

            // Envoyer l'email d'approbation
            try {
              const adminUser = await prisma.user.findUnique({
                where: { id: session.user.id },
                select: { name: true }
              })

              const adminName = adminUser?.name || 'Administrateur'
              const companyName = appointment.company?.name || 'Votre entreprise'

              await sendConsultationApprovedEmail(
                appointment.user.email,
                appointment.user.name || 'Utilisateur',
                appointment.title,
                companyName,
                adminName
              )

              console.log(`✅ Email d'approbation envoyé à ${appointment.user.email}`)
            } catch (emailError) {
              console.error('❌ Erreur envoi email approbation:', emailError)
            }
            break

          case 'REJECTED':
            await createNotification(
              appointment.userId,
              'consultation_rejected',
              'Consultation reportée',
              `Votre consultation "${appointment.title}" doit être reportée. Notre équipe vous contactera pour une nouvelle assignation.`,
              { appointmentId: appointment.id }
            )
            
            // Notifier le super admin pour réassignation
            const superAdminsForReject = await prisma.user.findMany({
              where: { role: 'SUPER_ADMIN' }
            })
            
            for (const admin of superAdminsForReject) {
              await createNotification(
                admin.id,
                'consultation_rejected',
                'Consultation refusée - Réassignation nécessaire',
                `La consultation "${appointment.title}" a été refusée par ${session.user.name}. Une réassignation est nécessaire.`,
                { appointmentId: appointment.id }
              )
            }

            // Notifier l'admin entreprise
            const adminEntrepriseRejected = await prisma.user.findFirst({
              where: { 
                companyId: appointment.companyId,
                role: 'ADMIN_ENTREPRISE'
              }
            })
            
            if (adminEntrepriseRejected) {
              await createNotification(
                adminEntrepriseRejected.id,
                'consultation_rejected',
                'Consultation reportée pour votre équipe',
                `La consultation "${appointment.title}" de ${appointment.user.name} a été reportée. Une nouvelle assignation sera effectuée.`,
                { appointmentId: appointment.id, employeeName: appointment.user.name }
              )
            }
            break

          case 'CANCELED':
            await createNotification(
              appointment.userId,
              'consultation_rejected',
              'Demande de consultation rejetée',
              `Votre demande "${appointment.title}" n'a pas pu être acceptée.`,
              { appointmentId: appointment.id }
            )

            // Envoyer l'email de refus
            try {
              const adminUser = await prisma.user.findUnique({
                where: { id: session.user.id },
                select: { name: true }
              })

              const adminName = adminUser?.name || 'Administrateur'
              const companyName = appointment.company?.name || 'Votre entreprise'
              const rejectionReason = notes || undefined

              await sendConsultationRejectedEmail(
                appointment.user.email,
                appointment.user.name || 'Utilisateur',
                appointment.title,
                companyName,
                adminName,
                rejectionReason
              )

              console.log(`✅ Email de refus envoyé à ${appointment.user.email}`)
            } catch (emailError) {
              console.error('❌ Erreur envoi email refus:', emailError)
            }
            break
        }
      }

      return NextResponse.json({
        message: 'Consultation mise à jour avec succès',
        appointment: updatedAppointment
      })
    }

  } catch (error) {
    console.error('Erreur mise à jour consultation:', error)
    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { id } = await params

    // Vérifier que la consultation existe et appartient à l'utilisateur
    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: {
        user: true,
        company: true
      }
    })

    if (!appointment) {
      return NextResponse.json({ error: 'Consultation non trouvée' }, { status: 404 })
    }

    // Vérifier les autorisations de suppression
    const canDelete = 
      appointment.userId === session.user.id ||
      (session.user.role === 'ADMIN_ENTREPRISE' && session.user.companyId === appointment.companyId) ||
      session.user.role === 'SUPER_ADMIN'

    if (!canDelete) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
    }

    // Supprimer la consultation
    await prisma.appointment.delete({
      where: { id }
    })

    return NextResponse.json({ message: 'Consultation supprimée avec succès' })

  } catch (error) {
    console.error('Erreur suppression consultation:', error)
    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    )
  }
} 