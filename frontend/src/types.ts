export interface User {
  id: string;
  email: string;
  username: string;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface LoginPayload {
  identifier: string;
  password: string;
}

export interface RegisterPayload {
  email: string;
  username: string;
  password: string;
}

export interface ChangePasswordPayload {
  current_password: string;
  new_password: string;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  prompt: string;
  test_code: string;
  language: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface ChallengeCreatePayload {
  title: string;
  description: string;
  prompt: string;
  test_code?: string;
  language?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface ChallengeListParams {
  page?: number;
  page_size?: number;
  search?: string;
  language?: string;
  owner_id?: string;
}

export type ChallengeUpdatePayload = Partial<ChallengeCreatePayload>;

export type SubmissionStatus = "pending" | "processing" | "completed" | "failed";

export interface EvaluationResult {
  id: string;
  passed_tests: number;
  total_tests: number;
  score: number;
  logs: string;
  metrics: Record<string, unknown>;
  /** Per-test-case breakdown: `[{name, passed, message}]`; absent for
   *  runners/results that carry no per-test detail. */
  test_results?: Array<{
    name: string;
    passed: boolean;
    message?: string | null;
  }> | null;
  created_at: string;
}

export interface Submission {
  id: string;
  user_id: string;
  challenge_id: string;
  status: SubmissionStatus;
  provider: string | null;
  language: string | null;
  code: string | null;
  score: number | null;
  evaluation_result: EvaluationResult | null;
  created_at: string;
  updated_at: string;
}

export interface SubmissionCreatePayload {
  challenge_id: string;
  provider: string;
  /** Per-run LLM API key — never stored server-side. */
  api_key?: string;
}

/** Aggregated evaluation stats for one provider on a challenge. */
export interface ProviderComparisonEntry {
  provider: string;
  runs: number;
  score: number;
  passed_tests: number;
  total_tests: number;
  duration_ms: number;
  last_run_at: string;
}

export interface ProviderComparison {
  challenge_id: string;
  entries: ProviderComparisonEntry[];
}

export interface SubmissionListParams {
  page?: number;
  page_size?: number;
  status?: SubmissionStatus;
  challenge_id?: string;
  provider?: string;
}

/** Share token for a completed evaluation report. */
export interface ShareResult {
  share_token: string;
}

/** Public view of a shared report (no auth required to fetch). */
export interface SharedResult {
  challenge_id: string;
  challenge_title: string;
  challenge_prompt: string;
  language: string;
  provider: string;
  status: SubmissionStatus;
  created_at: string;
  code: string | null;
  score: number;
  passed_tests: number;
  total_tests: number;
  logs: string;
  metrics: Record<string, unknown>;
  test_results?: Array<{
    name: string;
    passed: boolean;
    message?: string | null;
  }> | null;
}

export interface AdminUserUpdate {
  is_admin?: boolean;
  is_active?: boolean;
}

export interface AdminListParams {
  page?: number;
  page_size?: number;
  search?: string;
  status?: SubmissionStatus;
}

export interface PlatformStats {
  total_users: number;
  total_challenges: number;
  total_submissions: number;
  completed_submissions: number;
  failed_submissions: number;
  pending_submissions: number;
  average_score: number | null;
}