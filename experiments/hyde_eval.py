r"""
HyDE evaluation: does searching with a hypothetical answer find the right talk
more often than searching with the question itself?

Each test question has one "expected" talk that clearly answers it. For each
question we run the same retrieval the app does (match_sentences top 20 ->
group by talk -> rank talks by average similarity) twice: once embedding the
question (plain) and once embedding a HyDE passage. We report where the
expected talk lands. The app sends the top 3 talks to GPT, so "hit@3" is what
matters for RAG.

Usage (from the project root):
    .venv\Scripts\python experiments\hyde_eval.py

Edit TESTS to add your own questions. Cost: well under a cent per run.
"""

import json
from collections import defaultdict

from openai import OpenAI
from supabase import create_client

# Keep in sync with HYDE_PROMPT in supabase/functions/embed-question/index.ts.
HYDE_PROMPT = (
    "Write a short passage (3-4 sentences) that could appear in a General Conference talk "
    "and answers the question below. Write statements, not questions. Do not mention the question."
)

# (question, title of the talk that best answers it)
TESTS = [
    ("What responsibility do we have to take care of the earth and nature?",
     "Our Earthly Stewardship"),
    ("How did the pandemic change the way people could worship in temples?",
     "COVID-19 and Temples"),
    ("Can members trust that church donations are being handled properly?",
     "Church Auditing Department Report, 2023"),
    ("What makes a community or nation hold together over generations?",
     "Sustainable Societies"),
    ("After I repent and improve, how do I avoid slipping back into old habits?",
     "Keep the Change"),
    ("Why should I keep asking God for answers when I don't hear back right away?",
     "Ask, Seek, and Knock"),
    ("How can kindness become an everyday habit instead of something occasional?",
     "Let Doing Good Be Our Normal"),
    ("What can mothers and fathers learn from the way Heavenly Father raises His children?",
     "Divine Parenting Lessons"),
    ("What lesson can we learn from the Jaredite barges being pushed by the wind?",
     "The Wind Did Never Cease to Blow"),
    ("What is the special shout with white handkerchiefs done at temple dedications?",
     "Hosanna Shout"),
]

MATCH_COUNT = 20  # same as app.js searchSentences()


def rank_talks(sentences):
    """Same as groupByTalk() in app.js: rank talks by average sentence similarity."""
    sims = defaultdict(list)
    for s in sentences:
        sims[s['title']].append(s['similarity'])
    return sorted(sims, key=lambda title: -sum(sims[title]) / len(sims[title]))


def main():
    with open('config.public.json') as f:
        public = json.load(f)
    with open('config.secret.json') as f:
        secrets = json.load(f)
    openai = OpenAI(api_key=secrets['OPENAI_API_KEY'])
    db = create_client(public['SUPABASE_URL'], secrets['SUPABASE_SERVICE_KEY'])

    def embed(text):
        return openai.embeddings.create(model='text-embedding-3-small', input=text).data[0].embedding

    def hyde_passage(question):
        response = openai.chat.completions.create(
            model='gpt-4o-mini', temperature=0, max_tokens=200,
            messages=[{'role': 'system', 'content': HYDE_PROMPT},
                      {'role': 'user', 'content': question}])
        return response.choices[0].message.content

    def expected_rank(embedding, expected):
        sentences = db.rpc('match_sentences',
                           {'query_embedding': embedding, 'match_count': MATCH_COUNT}).execute().data
        ranking = rank_talks(sentences)
        return ranking.index(expected) + 1 if expected in ranking else None

    def show(rank):
        return f"#{rank}" if rank else "miss"

    hits = {'plain': 0, 'hyde': 0}
    print(f"{'plain':>6} {'HyDE':>6}  question")
    print('-' * 80)
    for question, expected in TESTS:
        plain = expected_rank(embed(question), expected)
        hyde = expected_rank(embed(hyde_passage(question)), expected)
        hits['plain'] += bool(plain and plain <= 3)
        hits['hyde'] += bool(hyde and hyde <= 3)
        print(f"{show(plain):>6} {show(hyde):>6}  {question}")

    n = len(TESTS)
    print('-' * 80)
    print(f"hit@3 (expected talk among the 3 sent to GPT):  plain {hits['plain']}/{n}   HyDE {hits['hyde']}/{n}")
    print("rank = position of the expected talk among talks found in the top "
          f"{MATCH_COUNT} sentences; miss = not found at all")


if __name__ == '__main__':
    main()
