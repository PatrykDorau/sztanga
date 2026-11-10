export type AppRole = 'trainer' | 'client' | 'parent'
export type ExerciseLevel = 'beginner' | 'intermediate' | 'advanced'
export type RelationKind = 'progression' | 'alternative'

export interface Profile {
  id: string
  role: AppRole
  full_name: string | null
}

export interface Exercise {
  id: string
  name_pl: string
  name_en: string | null
  muscle_groups: string[]
  equipment: string[]
  movement_pattern: string | null
  level: ExerciseLevel
  contraindications: string[]
  cues: string | null
  video_path: string | null
  image_url: string | null
  source: string
  external_id: string | null
  created_at: string
  updated_at: string
}

export type ExerciseInput = Omit<Exercise, 'id' | 'created_at' | 'updated_at' | 'source' | 'external_id'>

export interface ExerciseRelation {
  from_exercise: string
  to_exercise: string
  kind: RelationKind
}

export type ClientGroup = 'amateur' | 'athlete' | 'child'
export type ProgramStatus = 'draft' | 'active' | 'archived'

export interface Client {
  id: string
  user_id: string | null
  full_name: string
  email: string | null
  phone: string | null
  client_group: ClientGroup
  birth_date: string | null
  goals: string | null
  limitations: string[]
  equipment: string[]
  notes: string | null
  archived: boolean
  created_at: string
}

export interface Progression {
  kind: 'load' | 'reps'
  step: number
}

export interface WorkoutExercise {
  id: string
  workout_id: string
  exercise_id: string
  position: number
  group_label: string | null
  sets: number | null
  reps: string | null
  load: string | null
  tempo: string | null
  rest_sec: number | null
  rpe: number | null
  notes: string | null
  progression: Progression | null
}

export interface Workout {
  id: string
  week_id: string
  position: number
  name: string
  notes: string | null
  workout_exercises: WorkoutExercise[]
}

export interface ProgramWeek {
  id: string
  program_id: string
  position: number
  phase: string | null
  notes: string | null
  workouts: Workout[]
}

export interface Program {
  id: string
  name: string
  description: string | null
  is_template: boolean
  client_id: string | null
  template_id: string | null
  start_date: string | null
  status: ProgramStatus
  created_at: string
  updated_at: string
}

export interface ProgramTree extends Program {
  program_weeks: ProgramWeek[]
}
