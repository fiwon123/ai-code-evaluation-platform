export interface User {
  id: string;
  email: string;
  username: string;
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
}

export interface SubmissionListParams {
  page?: number;
  page_size?: number;
  status?: SubmissionStatus;
  challenge_id?: string;
  provider?: string;
}