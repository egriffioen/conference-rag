// CORS headers shared by every Edge Function.
// The browser page (egriffioen.github.io) and the functions (*.supabase.co) are
// different origins, so the browser only lets app.js read our responses if
// they carry these headers.
export const corsHeaders = {
  // Which origins may read the response. "*" = any site.
  "Access-Control-Allow-Origin": "*",
  // Which request headers the browser is allowed to send.
  // supabase-js sends authorization, apikey, x-client-info and content-type.
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Build a JSON response that always includes the CORS headers,
// so even error responses are readable by the browser.
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
