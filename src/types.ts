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
