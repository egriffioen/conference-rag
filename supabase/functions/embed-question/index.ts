// embed-question: turns a user's question into a 1,536-number embedding.
//
//   Browser --(question + JWT)--> this function --(OPENAI_API_KEY)--> OpenAI
//
// The OpenAI key lives only here, as a Supabase secret. The browser never sees it.
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getUser } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  // 1. CORS preflight: the browser asks "may I send this request?" before
  //    the real POST. Answer yes, with no body and no auth check (preflights
  //    never carry the Authorization header).
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 2. Only logged-in users may spend our OpenAI credits.
  const user = await getUser(req);
  if (!user) {
    return jsonResponse({ error: "You must be signed in." }, 401);
  }

  // 3. Validate the input. Never trust what the browser sends.
  let question: unknown;
  try {
    ({ question } = await req.json());
  } catch {
    return jsonResponse({ error: "Request body must be JSON." }, 400);
  }
  if (typeof question !== "string" || question.trim() === "") {
    return jsonResponse({ error: "Missing 'question'." }, 400);
  }
  if (question.length > 1000) {
    return jsonResponse({ error: "Question must be 1,000 characters or fewer." }, 400);
  }

  // 4. Ask OpenAI for the embedding. Same model as scripts/04_embed_data.py,
  //    so the question vector lives in the same "space" as the sentence vectors.
  const openaiResponse = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: question }),
  });

  if (!openaiResponse.ok) {
    // Log the details server-side (visible in the Supabase dashboard),
    // but don't leak them to the browser.
    console.error("OpenAI error:", openaiResponse.status, await openaiResponse.text());
    return jsonResponse({ error: "Failed to get embedding." }, 502);
  }

  // 5. OpenAI returns { data: [ { embedding: [...] } ], ... }
  const result = await openaiResponse.json();
  return jsonResponse({ embedding: result.data[0].embedding });
});
