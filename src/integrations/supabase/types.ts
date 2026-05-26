export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      classifications: {
        Row: {
          classified_at: string
          confidence: number | null
          id: string
          intent: string
          model_version: string | null
          query_id: string
        }
        Insert: {
          classified_at?: string
          confidence?: number | null
          id?: string
          intent: string
          model_version?: string | null
          query_id: string
        }
        Update: {
          classified_at?: string
          confidence?: number | null
          id?: string
          intent?: string
          model_version?: string | null
          query_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "classifications_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: true
            referencedRelation: "queries"
            referencedColumns: ["id"]
          },
        ]
      }
      import_queries: {
        Row: {
          clicks_current: number | null
          clicks_previous: number | null
          ctr_current: number | null
          ctr_previous: number | null
          id: string
          import_id: string
          impressions_current: number | null
          impressions_previous: number | null
          position_current: number | null
          position_previous: number | null
          query_id: string
        }
        Insert: {
          clicks_current?: number | null
          clicks_previous?: number | null
          ctr_current?: number | null
          ctr_previous?: number | null
          id?: string
          import_id: string
          impressions_current?: number | null
          impressions_previous?: number | null
          position_current?: number | null
          position_previous?: number | null
          query_id: string
        }
        Update: {
          clicks_current?: number | null
          clicks_previous?: number | null
          ctr_current?: number | null
          ctr_previous?: number | null
          id?: string
          import_id?: string
          impressions_current?: number | null
          impressions_previous?: number | null
          position_current?: number | null
          position_previous?: number | null
          query_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_queries_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_queries_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "queries"
            referencedColumns: ["id"]
          },
        ]
      }
      imports: {
        Row: {
          created_at: string
          file_name: string | null
          id: string
          period_end: string | null
          period_start: string | null
          project_id: string
          row_count: number | null
          source: string
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          id?: string
          period_end?: string | null
          period_start?: string | null
          project_id: string
          row_count?: number | null
          source?: string
        }
        Update: {
          created_at?: string
          file_name?: string | null
          id?: string
          period_end?: string | null
          period_start?: string | null
          project_id?: string
          row_count?: number | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "imports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          created_at: string
          error: string | null
          id: string
          import_id: string | null
          job_type: string
          payload: Json
          result: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          import_id?: string | null
          job_type: string
          payload?: Json
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          import_id?: string | null
          job_type?: string
          payload?: Json
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
        ]
      }
      keyword_metrics: {
        Row: {
          competition: number | null
          cpc: number | null
          device: string
          fetched_at: string
          id: string
          location_code: number
          month: string
          query_id: string
          search_volume: number | null
        }
        Insert: {
          competition?: number | null
          cpc?: number | null
          device: string
          fetched_at?: string
          id?: string
          location_code: number
          month: string
          query_id: string
          search_volume?: number | null
        }
        Update: {
          competition?: number | null
          cpc?: number | null
          device?: string
          fetched_at?: string
          id?: string
          location_code?: number
          month?: string
          query_id?: string
          search_volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "keyword_metrics_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "queries"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          org_id: string
          role: string
          user_id: string
        }
        Insert: {
          org_id: string
          role?: string
          user_id: string
        }
        Update: {
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      orgs: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          alt_domains: string[]
          branded_terms: string[]
          client_name: string
          created_at: string
          daily_serp_budget: number
          default_location_code: number
          device: string
          domain: string
          id: string
          org_id: string
        }
        Insert: {
          alt_domains?: string[]
          branded_terms?: string[]
          client_name: string
          created_at?: string
          daily_serp_budget?: number
          default_location_code?: number
          device?: string
          domain: string
          id?: string
          org_id: string
        }
        Update: {
          alt_domains?: string[]
          branded_terms?: string[]
          client_name?: string
          created_at?: string
          daily_serp_budget?: number
          default_location_code?: number
          device?: string
          domain?: string
          id?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      serp_jobs: {
        Row: {
          completed_at: string | null
          cost: number
          created_at: string
          dataforseo_task_id: string | null
          error: string | null
          id: string
          import_id: string
          location_code: number
          query_id: string
          status: string
          submitted_at: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          cost?: number
          created_at?: string
          dataforseo_task_id?: string | null
          error?: string | null
          id?: string
          import_id: string
          location_code?: number
          query_id: string
          status?: string
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          cost?: number
          created_at?: string
          dataforseo_task_id?: string | null
          error?: string | null
          id?: string
          import_id?: string
          location_code?: number
          query_id?: string
          status?: string
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "serp_jobs_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "serp_jobs_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "queries"
            referencedColumns: ["id"]
          },
        ]
      }
      queries: {
        Row: {
          created_at: string
          id: string
          query_hash: string
          query_text: string
        }
        Insert: {
          created_at?: string
          id?: string
          query_hash: string
          query_text: string
        }
        Update: {
          created_at?: string
          id?: string
          query_hash?: string
          query_text?: string
        }
        Relationships: []
      }
      risk_scores: {
        Row: {
          breakdown: Json
          id: string
          import_id: string
          scored_at: string
          traffic_risk_score: number
          weights_id: string | null
        }
        Insert: {
          breakdown?: Json
          id?: string
          import_id: string
          scored_at?: string
          traffic_risk_score: number
          weights_id?: string | null
        }
        Update: {
          breakdown?: Json
          id?: string
          import_id?: string
          scored_at?: string
          traffic_risk_score?: number
          weights_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "risk_scores_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: true
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_scores_weights_id_fkey"
            columns: ["weights_id"]
            isOneToOne: false
            referencedRelation: "risk_weights"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_weights: {
        Row: {
          active: boolean
          created_at: string
          id: string
          label: string
          weights: Json
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          label: string
          weights: Json
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string
          weights?: Json
        }
        Relationships: []
      }
      serp_snapshots: {
        Row: {
          aio_citation_count: number
          aio_word_count: number | null
          captured_at: string
          captured_date: string
          expires_at: string
          has_ai_overview: boolean
          has_featured_snippet: boolean
          has_local_pack: boolean
          has_shopping: boolean
          has_top_stories: boolean
          has_video: boolean
          id: string
          location_code: number
          pixels_above_first_organic: number | null
          publisher_in_ai_overview: boolean
          publisher_in_featured_snippet: boolean
          publisher_in_organic_top_3: boolean
          publisher_in_top_stories: boolean
          publisher_organic_position: number | null
          publisher_pixel_height: number | null
          query_id: string
          raw_serp_data: Json | null
          serp_response_version: string
          top_organic_domains: string[]
          top_stories_domains: string[]
        }
        Insert: {
          aio_citation_count?: number
          aio_word_count?: number | null
          captured_at?: string
          captured_date?: string
          expires_at?: string
          has_ai_overview?: boolean
          has_featured_snippet?: boolean
          has_local_pack?: boolean
          has_shopping?: boolean
          has_top_stories?: boolean
          has_video?: boolean
          id?: string
          location_code?: number
          pixels_above_first_organic?: number | null
          publisher_in_ai_overview?: boolean
          publisher_in_featured_snippet?: boolean
          publisher_in_organic_top_3?: boolean
          publisher_in_top_stories?: boolean
          publisher_organic_position?: number | null
          publisher_pixel_height?: number | null
          query_id: string
          raw_serp_data?: Json | null
          serp_response_version?: string
          top_organic_domains?: string[]
          top_stories_domains?: string[]
        }
        Update: {
          aio_citation_count?: number
          aio_word_count?: number | null
          captured_at?: string
          captured_date?: string
          expires_at?: string
          has_ai_overview?: boolean
          has_featured_snippet?: boolean
          has_local_pack?: boolean
          has_shopping?: boolean
          has_top_stories?: boolean
          has_video?: boolean
          id?: string
          location_code?: number
          pixels_above_first_organic?: number | null
          publisher_in_ai_overview?: boolean
          publisher_in_featured_snippet?: boolean
          publisher_in_organic_top_3?: boolean
          publisher_in_top_stories?: boolean
          publisher_organic_position?: number | null
          publisher_pixel_height?: number | null
          query_id?: string
          raw_serp_data?: Json | null
          serp_response_version?: string
          top_organic_domains?: string[]
          top_stories_domains?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "serp_snapshots_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "queries"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_my_org_ids: { Args: never; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
