import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateToken } from '@/lib/tokens'
import { sendEmail } from '@/lib/email'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { companyId } = await params
    const { email, role } = await request.json()

    // Validation
    if (!email || !role) {
      return NextResponse.json({ error: 'Email et rôle requis' }, { status: 400 })
    }

    // Vérifier les permissions
    if (session.user.role !== 'SUPER_ADMIN' && 
        session.user.role !== 'ADMIN_ENTREPRISE' && 
        session.user.companyId !== companyId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    // Vérifier si l'entreprise existe
    const company = await prisma.company.findUnique({
      where: { id: companyId }
    })

    if (!company) {
      return NextResponse.json({ error: 'Entreprise introuvable' }, { status: 404 })
    }

    // Vérifier si l'utilisateur existe déjà
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })

    if (existingUser) {
      return NextResponse.json({ error: 'Un utilisateur avec cet email existe déjà' }, { status: 409 })
    }

    // Générer un token d'invitation
    const invitationToken = generateToken()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 jours

    // Créer l'invitation en base
    const invitation = await prisma.invitation.create({
      data: {
        email,
        role,
        token: invitationToken,
        expiresAt,
        companyId,
        senderId: session.user.id
      }
    })

    // Envoyer l'email d'invitation
    const invitationUrl = `${process.env.NEXTAUTH_URL}/auth/accept-invitation?token=${invitationToken}`
    
    await sendEmail({
      to: email,
      subject: `Invitation à rejoindre ${company.name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1f2937;">Invitation à rejoindre ${company.name}</h2>
          
          <p>Bonjour,</p>
          
          <p>Vous avez été invité(e) à rejoindre <strong>${company.name}</strong> sur FormConsult avec le rôle <strong>${role}</strong>.</p>
          
          <p>Pour accepter cette invitation et créer votre compte, cliquez sur le lien ci-dessous :</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${invitationUrl}" 
               style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Accepter l'invitation
            </a>
          </div>
          
          <p style="color: #6b7280; font-size: 14px;">
            Cette invitation expire le ${expiresAt.toLocaleDateString('fr-FR')} à ${expiresAt.toLocaleTimeString('fr-FR')}.
          </p>
          
          <p style="color: #6b7280; font-size: 14px;">
            Si vous n'avez pas demandé cette invitation, vous pouvez ignorer cet email.
          </p>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          
          <p style="color: #9ca3af; font-size: 12px; text-align: center;">
            FormConsult - Plateforme de formation professionnelle
          </p>
        </div>
      `
    })

    return NextResponse.json({
      message: 'Invitation envoyée avec succès',
      invitationId: invitation.id
    })

  } catch (error) {
    console.error('Erreur lors de l\'envoi de l\'invitation:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
} 