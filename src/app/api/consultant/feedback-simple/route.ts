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

    if (session.user.role !== 'CONSULTANT') {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || '30d'
    
    const consultantId = session.user.id

    // Calculer la date de début selon la période
    const now = new Date()
    let startDate = new Date()
    
    switch (period) {
      case '7d':
        startDate.setDate(now.getDate() - 7)
        break
      case '30d':
        startDate.setDate(now.getDate() - 30)
        break
      case '90d':
        startDate.setDate(now.getDate() - 90)
        break
      case '1y':
        startDate.setFullYear(now.getFullYear() - 1)
        break
      default:
        startDate.setDate(now.getDate() - 30)
    }

    // 1. Récupérer toutes les consultations terminées du consultant
    const completedAppointments = await prisma.appointment.findMany({
      where: {
        consultantId: consultantId,
        status: 'COMPLETED',
        completedAt: {
          gte: startDate,
          lte: now
        }
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        company: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        completedAt: 'desc'
      }
    })

    // 2. Récupérer tous les retours du consultant
    const feedbacks = await prisma.consultationFeedback.findMany({
      where: {
        appointment: {
          consultantId: consultantId
        },
        createdAt: {
          gte: startDate,
          lte: now
        }
      },
      include: {
        appointment: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            },
            company: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    // 3. Calculer les statistiques globales
    const totalFeedbacks = feedbacks.length
    const averageRating = totalFeedbacks > 0 
      ? Math.round((feedbacks.reduce((sum, f) => sum + f.rating, 0) / totalFeedbacks) * 10) / 10
      : 0

    const satisfactionRating = totalFeedbacks > 0
      ? Math.round((feedbacks.reduce((sum, f) => sum + f.satisfactionLevel, 0) / totalFeedbacks) * 10) / 10
      : 0

    const recommendationRate = totalFeedbacks > 0
      ? Math.round((feedbacks.filter(f => f.wouldRecommend).length / totalFeedbacks) * 100)
      : 0

    const responseRate = completedAppointments.length > 0 
      ? Math.round((totalFeedbacks / completedAppointments.length) * 100) 
      : 0

    // 4. Distribution des notes
    const ratingDistribution = {
      5: feedbacks.filter(f => f.rating === 5).length,
      4: feedbacks.filter(f => f.rating === 4).length,
      3: feedbacks.filter(f => f.rating === 3).length,
      2: feedbacks.filter(f => f.rating === 2).length,
      1: feedbacks.filter(f => f.rating === 1).length
    }

    // 5. Évolution des notes par semaine (4 dernières semaines)
    const weeklyRatings = []
    for (let i = 3; i >= 0; i--) {
      const weekStart = new Date()
      weekStart.setDate(now.getDate() - (i * 7))
      weekStart.setHours(0, 0, 0, 0)
      
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekStart.getDate() + 6)
      weekEnd.setHours(23, 59, 59, 999)

      const weekFeedbacks = feedbacks.filter(f => {
        const feedbackDate = new Date(f.createdAt)
        return feedbackDate >= weekStart && feedbackDate <= weekEnd
      })

      const weekRating = weekFeedbacks.length > 0 
        ? Math.round((weekFeedbacks.reduce((sum, f) => sum + f.rating, 0) / weekFeedbacks.length) * 10) / 10
        : 0

      const weekSatisfaction = weekFeedbacks.length > 0 
        ? Math.round((weekFeedbacks.reduce((sum, f) => sum + f.satisfactionLevel, 0) / weekFeedbacks.length) * 10) / 10
        : 0

      weeklyRatings.push({
        week: `S${4-i}`,
        rating: weekRating,
        count: weekFeedbacks.length,
        satisfaction: weekSatisfaction
      })
    }

    // 6. Analyse des commentaires (basic sentiment)
    const positiveKeywords = ['excellent', 'très bien', 'parfait', 'génial', 'remarquable', 'exceptionnel', 'superbe', 'fantastique']
    const negativeKeywords = ['mauvais', 'décevant', 'insatisfaisant', 'problème', 'difficile', 'compliqué']
    
    let positive = 0, negative = 0, neutral = 0
    
    feedbacks.forEach(feedback => {
      if (feedback.comments) {
        const comment = feedback.comments.toLowerCase()
        const hasPositive = positiveKeywords.some(keyword => comment.includes(keyword))
        const hasNegative = negativeKeywords.some(keyword => comment.includes(keyword))
        
        if (hasPositive && !hasNegative) {
          positive++
        } else if (hasNegative && !hasPositive) {
          negative++
        } else {
          neutral++
        }
      } else {
        neutral++
      }
    })

    // 7. Top des domaines d'amélioration
    const improvementAreas: Record<string, number> = {}
    feedbacks.forEach(feedback => {
      if (feedback.improvementAreas && Array.isArray(feedback.improvementAreas)) {
        feedback.improvementAreas.forEach((area: string) => {
          improvementAreas[area] = (improvementAreas[area] || 0) + 1
        })
      }
    })

    const topImprovementAreas = Object.entries(improvementAreas)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([area, count]) => ({ area, count }))

    // 8. Consultations sans retour
    const pendingFeedback = completedAppointments
      .filter(apt => !feedbacks.some(f => f.appointmentId === apt.id))
      .map(apt => ({
        id: apt.id,
        title: apt.title,
        clientName: apt.user.name,
        companyName: apt.company.name,
        completedAt: apt.completedAt,
        daysSinceCompletion: Math.floor((now.getTime() - new Date(apt.completedAt || apt.createdAt).getTime()) / (1000 * 60 * 60 * 24))
      }))

    // 9. Insights calculés
    const bestRatedWeek = weeklyRatings.reduce((max, week) => 
      week.rating > (max?.rating || 0) ? week : max, null
    )

    const avgResponseTime = feedbacks.length > 0 
      ? Math.round(
          feedbacks.reduce((sum, f) => {
            const appointment = completedAppointments.find(apt => apt.id === f.appointmentId)
            if (appointment && appointment.completedAt) {
              const daysDiff = Math.floor((new Date(f.createdAt).getTime() - new Date(appointment.completedAt).getTime()) / (1000 * 60 * 60 * 24))
              return sum + Math.max(0, daysDiff)
            }
            return sum
          }, 0) / feedbacks.length
        )
      : 0

    // 10. Formatage des retours récents
    const recentFeedbacks = feedbacks.slice(0, 10).map(feedback => ({
      id: feedback.id,
      rating: feedback.rating,
      satisfactionLevel: feedback.satisfactionLevel,
      wouldRecommend: feedback.wouldRecommend,
      comments: feedback.comments,
      improvementAreas: feedback.improvementAreas || [],
      createdAt: feedback.createdAt,
      client: {
        name: feedback.appointment.user.name,
        company: feedback.appointment.company.name
      },
      appointment: {
        id: feedback.appointment.id,
        title: feedback.appointment.title,
        date: feedback.appointment.scheduledAt
      }
    }))

    const responseData = {
      summary: {
        totalFeedbacks,
        averageRating,
        satisfactionRating,
        recommendationRate,
        totalConsultations: completedAppointments.length,
        responseRate
      },
      ratingDistribution,
      weeklyRatings,
      recentFeedbacks,
      commentAnalysis: {
        positive,
        negative,
        neutral,
        totalComments: feedbacks.filter(f => f.comments).length
      },
      topImprovementAreas,
      pendingFeedback,
      insights: {
        bestRatedMonth: bestRatedWeek,
        mostCommonImprovement: topImprovementAreas[0]?.area || null,
        avgResponseTime
      }
    }

    return NextResponse.json(responseData)

  } catch (error) {
    console.error('Erreur récupération retours consultant:', error)
    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    )
  }
} 