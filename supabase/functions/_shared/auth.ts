import { createClient, type User } from "npm:@supabase/supabase-js@2";

// Returns the logged-in user who sent this request, or null.
//
// We deploy with --no-verify-jwt, so Supabase does NOT check the token before
// our code runs. This function is that check.
export async function getUser(req: Request): Promise<User | null> {
  // supabase-js sends "Authorization: Bearer <token>".
  // Logged in  -> <token> is the user's session JWT.
  // Logged out -> <token> is the anon key.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length);

  // SUPABASE_URL and SUPABASE_ANON_KEY are provided to every Edge Function
  // automatically. We use the anon key (not service_role): we only need to
  // ask Supabase Auth "who is this?", not bypass RLS.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );

  // Supabase Auth checks the token's signature and expiry and looks up the
  // user. The anon key is a valid JWT but belongs to no user, so it fails here.
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}
