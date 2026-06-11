export interface Idea {
  documentId: string;
  title: string;
  description: string;
  category: 'saas' | 'tool' | 'api' | 'ai' | 'mobile' | 'other';
  status: 'captured' | 'analyzing' | 'analyzed' | 'prioritized' | 'brainstorming' | 'building' | 'launched' | 'archived';
  tags: string[];
  source?: string;
  analysis?: Analysis;
  priority?: Priority;
  repo?: Repo;
  notes?: Note[];
  brainstorm_sessions?: BrainstormSession[];
  createdAt: string;
  updatedAt: string;
}

export interface Analysis {
  documentId: string;
  problem_statement?: string;
  target_audience?: string;
  business_model?: string;
  revenue_potential?: string;
  technical_complexity?: string;
  dev_effort_hours?: number;
  risk_assessment?: string;
  market_opportunity?: string;
  viability_score?: number;
  raw_ai_output?: string;
  createdAt: string;
}

export interface Priority {
  documentId: string;
  revenue_score?: number;
  interest_score?: number;
  opportunity_score?: number;
  complexity_score?: number;
  final_score?: number;
  rank?: number;
  createdAt: string;
}

export interface Repo {
  documentId: string;
  repo_name?: string;
  repo_url?: string;
  visibility?: string;
  generated_files?: unknown;
  github_created?: boolean;
  createdAt: string;
}

export interface Note {
  documentId: string;
  content: string;
  idea?: Idea;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email: string;
  username: string;
}

// =====================================================================
// v2 TYPES — Brainstorm, Build, Refine
// =====================================================================

export interface BrainstormSession {
  documentId: string;
  idea?: Idea;
  status: BrainstormStatus;
  architecture_proposal?: ArchitectureProposal;
  chosen_architecture?: ArchitectureOption;
  human_approval_stage: ApprovalStage;
  build_layers?: string[];
  current_build_layer?: string;
  build_progress: number;
  generated_repo_url?: string;
  iteration_count: number;
  qa_summary?: Record<string, string>;
  build_steps?: BuildStep[];
  questions?: ClarifyingQuestion[];
  refinements?: RefinementRequest[];
  createdAt: string;
  updatedAt: string;
}

export type BrainstormStatus =
  | 'pending'
  | 'brainstorming'
  | 'awaiting_architecture_approval'
  | 'qa_in_progress'
  | 'qa_completed'
  | 'awaiting_plan_approval'
  | 'ready_to_build'
  | 'building'
  | 'build_completed'
  | 'awaiting_review'
  | 'completed'
  | 'refining'
  | 'failed';

export type ApprovalStage = 'none' | 'architecture_approved' | 'qa_approved' | 'build_approved';

export interface ArchitectureProposal {
  options: ArchitectureOption[];
}

export interface ArchitectureOption {
  id: string;
  name: string;
  description: string;
  stack: string[];
  pros: string[];
  cons: string[];
  estimated_hours: number;
  best_for: string;
}

export interface ClarifyingQuestion {
  documentId: string;
  session?: BrainstormSession;
  question_text: string;
  question_type: 'single_choice' | 'multiple_choice' | 'text' | 'boolean';
  options: string[];
  context?: string;
  answer?: string;
  asked_via: 'web' | 'telegram' | 'both';
  answered_via?: 'web' | 'telegram';
  status: 'pending' | 'answered' | 'skipped';
  follow_up_for?: ClarifyingQuestion;
  order: number;
}

export interface BuildStep {
  documentId: string;
  session?: BrainstormSession;
  layer: string;
  status: BuildStepStatus;
  prompt_used?: string;
  output_summary?: string;
  files_generated?: BuildFile[];
  error_message?: string;
  started_at?: string;
  completed_at?: string;
  order: number;
}

export type BuildStepStatus = 'pending' | 'generating' | 'completed' | 'failed' | 'approved' | 'regenerating';

export interface BuildFile {
  path: string;
  lines: number;
}

export interface RefinementRequest {
  documentId: string;
  session?: BrainstormSession;
  request_text: string;
  target_layers?: string[];
  status: 'pending' | 'analyzing' | 'processing' | 'completed' | 'failed';
  impact_analysis?: string;
  changes_made?: string;
  iteration_number: number;
}

export interface BuildStatus {
  status: BrainstormStatus;
  progress: number;
  current_layer: string | null;
  current_layer_status: string | null;
  layers: {
    layer: string;
    status: BuildStepStatus;
    files_count: number;
    output_summary?: string;
    error?: string;
    started_at?: string;
    completed_at?: string;
  }[];
  completed_count: number;
  total_count: number;
}
