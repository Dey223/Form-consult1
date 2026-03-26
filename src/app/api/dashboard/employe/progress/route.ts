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

    if (session.user.role !== 'EMPLOYE') {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const userId = session.user.id
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || '30d' // 7d, 30d, 90d, 1y

    // Calculer les dates selon la période
    const now = new Date()
    const startDate = new Date()
    
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

    // 1. Récupérer les formations de l'utilisateur
    const userFormations = await prisma.userFormation.findMany({
      where: { userId: userId },
      include: {
        formation: {
          select: {
            id: true,
            title: true,
            level: true,
            createdAt: true
          }
        }
      }
    })

    // 2. Récupérer les sessions d'activité sur la période
    const learningActivities = await prisma.learningActivity.findMany({
      where: {
        userId: userId,
        createdAt: {
          gte: startDate,
          lte: now
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    })

    // 3. Calculer les statistiques globales
    const totalFormations = userFormations.length
    const completedFormations = userFormations.filter(uf => uf.progress === 100).length
    const inProgressFormations = userFormations.filter(uf => uf.progress > 0 && uf.progress < 100).length

    // 4. Calculer le temps total passé
    const totalTimeSpent = learningActivities.reduce((sum, activity) => 
      sum + (activity.timeSpent || 0), 0
    )

    // 5. Progression hebdomadaire
    const weeklyProgress = []
    const daysInPeriod = Math.ceil((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    const weeksCount = Math.ceil(daysInPeriod / 7)

    for (let i = 0; i < weeksCount; i++) {
      const weekStart = new Date(startDate)
      weekStart.setDate(startDate.getDate() + i * 7)
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekStart.getDate() + 7)

      const weekActivities = learningActivities.filter(activity => 
        activity.createdAt >= weekStart && activity.createdAt < weekEnd
      )

      const weekTime = weekActivities.reduce((sum, activity) => 
        sum + (activity.timeSpent || 0), 0
      )

      weeklyProgress.push({
        week: `S${i + 1}`,
        hours: Math.round(weekTime / 3600 * 100) / 100, // Convertir en heures
        activities: weekActivities.length
      })
    }

    // 6. Progression par formation
    const formationProgress = userFormations.map(uf => {
      const formationActivities = learningActivities.filter(activity => 
        activity.formationId === uf.formationId
      )
      
      const timeSpent = formationActivities.reduce((sum, activity) => 
        sum + (activity.timeSpent || 0), 0
      )

      return {
        formationId: uf.formationId,
        formationTitle: uf.formation.title,
        level: uf.formation.level,
        progress: uf.progress,
        timeSpent: Math.round(timeSpent / 3600 * 100) / 100, // En heures
        activitiesCount: formationActivities.length,
        lastActivity: formationActivities[formationActivities.length - 1]?.createdAt || uf.createdAt
      }
    })

    // 7. Compétences développées (basé sur les niveaux de formation)
    const skillsProgress: Record<string, { total: number; completed: number }> = {}
    userFormations.forEach(uf => {
      const skill = uf.formation.level || 'Général'
      if (!skillsProgress[skill]) {
        skillsProgress[skill] = { total: 0, completed: 0 }
      }
      skillsProgress[skill].total++
      if (uf.progress === 100) {
        skillsProgress[skill].completed++
      }
    })

    const skillsArray = Object.entries(skillsProgress).map(([skill, data]) => ({
      skill,
      level: data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0,
      completedFormations: data.completed,
      totalFormations: data.total
    }))

    // 8. Tendances et insights
    const recentActivities = learningActivities.slice(-10)
    const averageSessionTime = learningActivities.length > 0 
      ? totalTimeSpent / learningActivities.length / 60 // en minutes
      : 0

    // Calculer la régularité (jours avec activité)
    const activeDays = new Set(
      learningActivities.map(activity => 
        activity.createdAt.toISOString().split('T')[0]
      )
    ).size

    const consistencyRate = activeDays / daysInPeriod * 100

    // 9. Sessions de formation assistées
    const attendedSessions = await prisma.sessionAttendance.findMany({
      where: {
        userId: userId,
        session: {
          startDate: {
            gte: startDate,
            lte: now
          }
        }
      },
      include: {
        session: {
          include: {
            formation: {
              select: {
                title: true,
                level: true
              }
            }
          }
        }
      }
    })

    const progressData = {
      summary: {
        totalFormations,
        completedFormations,
        inProgressFormations,
        totalTimeSpent: Math.round(totalTimeSpent / 3600 * 100) / 100, // en heures
        averageSessionTime: Math.round(averageSessionTime),
        consistencyRate: Math.round(consistencyRate),
        activeDays,
        totalActivities: learningActivities.length
      },
      weeklyProgress,
      formationProgress: formationProgress.sort((a, b) => 
        new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
      ),
      skillsProgress: skillsArray,
      recentActivities: recentActivities.map(activity => ({
        id: activity.id,
        type: activity.activityType,
        formationId: activity.formationId,
        timeSpent: Math.round(activity.timeSpent / 60), // en minutes
        createdAt: activity.createdAt
      })),
      sessionsAttended: attendedSessions.map(attendance => ({
        sessionId: attendance.sessionId,
        formationTitle: attendance.session.formation.title,
        sessionDate: attendance.session.startDate,
        isConfirmed: attendance.isPresent
      })),
      insights: {
        mostActiveFormation: formationProgress.reduce((max, formation) => 
          formation.activitiesCount > (max?.activitiesCount || 0) ? formation : max, null
        ),
        preferredLearningTime: getMostActiveTimeOfDay(learningActivities),
        streakDays: calculateCurrentStreak(learningActivities)
      }
    }

    return NextResponse.json(progressData)

  } catch (error) {
    console.error('Erreur récupération progrès:', error)
    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    )
  }
}

// Fonctions utilitaires
function getMostActiveTimeOfDay(activities) {
  const timeSlots = { morning: 0, afternoon: 0, evening: 0 }
  
  activities.forEach(activity => {
    const hour = activity.createdAt.getHours()
    if (hour < 12) timeSlots.morning++
    else if (hour < 18) timeSlots.afternoon++
    else timeSlots.evening++
  })

  return Object.entries(timeSlots).reduce((max, [time, count]) => 
    count > (timeSlots[max] || 0) ? time : max, 'morning'
  )
}

function calculateCurrentStreak(activities) {
  if (activities.length === 0) return 0

  const today = new Date()
  let streak = 0
  let currentDate = new Date(today)

  // Obtenir les jours uniques d'activité
  const activeDays = new Set(
    activities.map(activity => 
      activity.createdAt.toISOString().split('T')[0]
    )
  )

  // Compter les jours consécutifs en remontant
  while (true) {
    const dateStr = currentDate.toISOString().split('T')[0]
    if (activeDays.has(dateStr)) {
      streak++
      currentDate.setDate(currentDate.getDate() - 1)
    } else {
      break
    }
  }

  return streak
} 