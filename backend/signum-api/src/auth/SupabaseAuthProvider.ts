import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AuthIdentity, AuthProvider } from './AuthProvider.js';
import { ApiError } from '../errors.js';

export class SupabaseAuthProvider implements AuthProvider {
  private readonly client: SupabaseClient;
  constructor(url: string, publishableKey: string) {
    this.client = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) },
    });
  }
  async verifyToken(token: string): Promise<AuthIdentity> {
    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data.user) throw new ApiError(401, 'INVALID_TOKEN');
    // Neither browser metadata nor JWT tenant/role claims establish authorization.
    return { userId: data.user.id };
  }
}
