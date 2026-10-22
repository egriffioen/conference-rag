// generate-answer: given a question and relevant talks, return an AI-written answer.
//
//   Browser --(question + context_talks + JWT)--> this function --(OPENAI_API_KEY)--> OpenAI
//
// The browser already did the retrieval (embed -> match_sentences -> top talks).
// This function only does the "G" in RAG: turn the talks + question into a
// prompt, ask GPT-4o, and hand the answer back.
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getUser } from "../_shared/auth.ts";

// Limits on what the browser may send. They cap what one request can cost.
// app.js sends 3 talks; the longest real talk is ~15,000 characters, so
// 30,000 leaves room for normal talks while blocking padded input.
const MAX_TALKS = 3;
const MAX_TALK_CHARS = 30000;

const SYSTEM_PROMPT = `Use these talks, and only the talks provided, to answer the question. No outside sources or internal knowledge is allowed.
When you answer, cite the talk title and the speaker within the answer. Never hallucinate or just make up an answer.
If the talks don't answer the question, or are not relevant enough, just say so.`;

// The shape of one talk as app.js sends it (it also sends extra fields we ignore).
type Talk = { title: string; speaker: string; text: string };

Deno.serve(async (req) => {
  // 1. CORS preflight.
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
  let contextTalks: unknown;
  try {
    ({ question, context_talks: contextTalks } = await req.json());
  } catch {
    return jsonResponse({ error: "Request body must be JSON." }, 400);
  }
  if (typeof question !== "string" || question.trim() === "") {
    return jsonResponse({ error: "Missing 'question'." }, 400);
  }
  if (question.length > 1000) {
    return jsonResponse({ error: "Question must be 1,000 characters or fewer." }, 400);
  }

  // The readiness check in app.js sends an empty list on every page load.
  // Reject it here so it never costs an OpenAI call.
  if (!Array.isArray(contextTalks) || contextTalks.length === 0) {
    return jsonResponse({ error: "Missing 'context_talks'." }, 400);
  }

  if (contextTalks.length > MAX_TALKS) {
    return jsonResponse({ error: `At most ${MAX_TALKS} talks may be sent.` }, 400);
  }
  // talk?. guards against entries like null, which would otherwise crash.
  const hasBadTalk = contextTalks.some((talk) =>
    typeof talk?.title !== "string" ||
    typeof talk?.speaker !== "string" ||
    typeof talk?.text !== "string"
  );
  if (hasBadTalk) {
    return jsonResponse({ error: "Each talk needs a title, speaker, and text." }, 400);
  }
  const talks = contextTalks as Talk[];
  if (talks.some((talk) => talk.text.length > MAX_TALK_CHARS)) {
    return jsonResponse(
      { error: `Each talk must be ${MAX_TALK_CHARS.toLocaleString()} characters or fewer.` },
      400,
    );
  }

  // 4. Build the user message: every talk, clearly labeled so the model can
  //    cite it, then the question.
  const context = talks
    .map((talk, i) => `[Talk ${i + 1}] "${talk.title}" by ${talk.speaker}\n${talk.text}`)
    .join("\n\n");

  const userMessage = `Conference talks:\n\n${context}\n\nQuestion: ${question}`;

  // 5. Ask GPT-4o. This is the chat endpoint, not the embeddings endpoint.
  const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!openaiResponse.ok) {
    console.error("OpenAI error:", openaiResponse.status, await openaiResponse.text());
    return jsonResponse({ error: "Failed to generate an answer." }, 502);
  }

  // 6. OpenAI replies with { choices: [ { message: { content: "..." } } ], usage: {...} }.
  //    app.js expects { answer: "..." }, so translate between the two.
  const result = await openaiResponse.json();
  const answer = result.choices?.[0]?.message?.content;
  if (typeof answer !== "string") {
    console.error("Unexpected OpenAI response:", JSON.stringify(result));
    return jsonResponse({ error: "Failed to generate an answer." }, 502);
  }

  return jsonResponse({ answer });
});
