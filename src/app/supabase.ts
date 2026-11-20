/**
 * The Supabase project behind signing in (#144). Both values are public by
 * design: the publishable key allows only what the auth settings and the
 * Storage policies in `supabase/migrations/` allow. Kept apart from
 * `account.ts` so the build's Content Security Policy can read the URL.
 */
export const SUPABASE_URL = 'https://hcdkilwcquhiiwfsrmzy.supabase.co';

export const SUPABASE_KEY = 'sb_publishable_vdvHc1ud77HskzcOxI-Cyw_01x7972C';

/** Where auth-js keeps the session; the PKCE verifier adds `-code-verifier` */
export const SESSION_KEY = 'sb-hcdkilwcquhiiwfsrmzy-auth-token';
