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