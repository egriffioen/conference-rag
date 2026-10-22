r"""
Embedding playground: embed a few short texts and compare them pairwise.

Usage (from the project root):
    .venv\Scripts\python experiments\embedding_playground.py

Edit PAIRS to try your own comparisons. Cost is a tiny fraction of a cent.
"""

import json
import math

from openai import OpenAI

PAIRS = [
    ("A", "I have hope for the future", "I have no hope for the future"),
    ("B", "I have hope for the future", "Brighter days are ahead of us"),
    ("C", "I have hope for the future", "The recipe calls for two cups of flour"),
    ("D", "faith", "fath"),
    ("E", "charity", "cahrity"),
    ("F", "feeling sad", "feeling bad"),
    ("G", "How can I find peace during hard times?",
          "The Savior offers comfort to those who mourn."),
]


def cosine_similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    return dot / (norm_a * norm_b)


def main():
    with open('config.secret.json') as f:
        client = OpenAI(api_key=json.load(f)['OPENAI_API_KEY'])

    # One API call for every unique text
    texts = sorted({t for _, a, b in PAIRS for t in (a, b)})
    response = client.embeddings.create(model='text-embedding-3-small', input=texts)
    vectors = {t: item.embedding for t, item in zip(texts, response.data)}

    sample = vectors[PAIRS[0][1]]
    print(f"Each vector has {len(sample)} numbers. First 5 for '{PAIRS[0][1]}':")
    print("   ", [round(x, 4) for x in sample[:5]])
    print(f"    vector length (norm): {math.sqrt(sum(x * x for x in sample)):.4f}\n")

    results = [(label, a, b, cosine_similarity(vectors[a], vectors[b])) for label, a, b in PAIRS]
    for label, a, b, sim in sorted(results, key=lambda r: -r[3]):
        print(f"{label}  {sim:.3f}  '{a}'  vs  '{b}'")


if __name__ == '__main__':
    main()
