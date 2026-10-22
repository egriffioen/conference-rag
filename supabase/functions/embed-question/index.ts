// embed-question: turns a user's question into a 1,536-number embedding.
//
//   Browser --(question + JWT)--> this function --(OPENAI_API_KEY)--> OpenAI
//
// The OpenAI key lives only here, as a Supabase secret. The browser never sees it.
//
// Optional HyDE mode ({ hyde: true }): instead of embedding the question itself,
// first have a chat model write a short hypothetical conference-style answer,
// then embed that. The database holds statements, not questions, so a
// statement-shaped search key tends to land closer to the real answers.
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getUser } from "../_shared/auth.ts";

// Keep in sync with HYDE_PROMPT in experiments/hyde_eval.py.
const HYDE_PROMPT =
  "Write a short passage (3-4 sentences) that could appear in a General Conference talk " +
  "and answers the question below. Write statements, not questions. Do not mention the question.";

const OPENAI_HEADERS = {
  "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
  "Content-Type": "application/json",
};

// Returns the hypothetical answer text, or null if OpenAI fails.
async function writeHypotheticalAnswer(question: string): Promise<string | null> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: OPENAI_HEADERS,
    body: JSON.stringify({
      // A small, fast model is enough: the passage only needs the right
      // vocabulary and topic, not perfect facts. It is never shown as an answer.
      model: "gpt-4o-mini",
      temperature: 0, // same question -> same passage, so experiments are repeatable
      max_tokens: 200,
      messages: [
        { role: "system", content: HYDE_PROMPT },
        { role: "user", content: question },
      ],
    }),
  });
  if (!response.ok) {
    console.error("OpenAI HyDE error:", response.status, await response.text());
    return null;
  }
  const result = await response.json();
  const text = result.choices?.[0]?.message?.content;
  return typeof text === "string" ? text : null;
}

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
  let hyde: unknown;
  try {
    ({ question, hyde } = await req.json());
  } catch {
    return jsonResponse({ error: "Request body must be JSON." }, 400);
  }
  if (typeof question !== "string" || question.trim() === "") {
    return jsonResponse({ error: "Missing 'question'." }, 400);
  }
  if (question.length > 1000) {
    return jsonResponse({ error: "Question must be 1,000 characters or fewer." }, 400);
  }

  // 4. Decide what text to embed: the question, or (HyDE) a hypothetical answer.
  let textToEmbed = question;
  let hypothetical: string | null = null;
  if (hyde === true) {
    hypothetical = await writeHypotheticalAnswer(question);
    if (hypothetical === null) {
      return jsonResponse({ error: "Failed to write HyDE passage." }, 502);
    }
    textToEmbed = hypothetical;
  }

  // 5. Ask OpenAI for the embedding. Same model as scripts/04_embed_data.py,
  //    so the vector lives in the same "space" as the sentence vectors.
  const openaiResponse = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: OPENAI_HEADERS,
    body: JSON.stringify({ model: "text-embedding-3-small", input: textToEmbed }),
  });

  if (!openaiResponse.ok) {
    // Log the details server-side (visible in the Supabase dashboard),
    // but don't leak them to the browser.
    console.error("OpenAI error:", openaiResponse.status, await openaiResponse.text());
    return jsonResponse({ error: "Failed to get embedding." }, 502);
  }

  // 6. OpenAI returns { data: [ { embedding: [...] } ], ... }
  //    hypothetical is null unless HyDE was used; the UI shows it when present.
  const result = await openaiResponse.json();
  return jsonResponse({ embedding: result.data[0].embedding, hypothetical });
});
