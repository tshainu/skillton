/**
 * Semantic vectors. OpenAI `text-embedding-3-small` (1536 dims) when a key is
 * available, with a deterministic hashed bag-of-words fallback so matching still
 * works offline / without a key. Vectors are always L2-normalized, so cosine
 * similarity is a plain dot product.
 */

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const FALLBACK_DIMS = 512;

function normalize(vec: number[]): number[] {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum) || 1;
  return vec.map((v) => v / norm);
}

function hash(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Deterministic hashed TF vector — used when no OpenAI key is configured. */
export function fallbackEmbedding(text: string): number[] {
  const vec = new Array<number>(FALLBACK_DIMS).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
  for (const token of tokens) vec[hash(token) % FALLBACK_DIMS] += 1;
  for (let i = 0; i < tokens.length - 1; i++) {
    vec[hash(`${tokens[i]}_${tokens[i + 1]}`) % FALLBACK_DIMS] += 0.5;
  }
  return normalize(vec.map((v) => (v > 0 ? 1 + Math.log(v) : 0)));
}

export async function embed(text: string): Promise<number[]> {
  const input = text.slice(0, 24000).trim();
  if (!input) return new Array<number>(FALLBACK_DIMS).fill(0);
  if (!OPENAI_KEY) return fallbackEmbedding(input);

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input }),
    });
    if (!res.ok) throw new Error(`embeddings ${res.status}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    const vector = json.data[0]?.embedding;
    if (!vector?.length) throw new Error("empty embedding");
    return normalize(vector);
  } catch {
    return fallbackEmbedding(input);
  }
}

/** Cosine similarity of two normalized vectors (dot product), clamped to [0,1]. */
export function cosine(a: number[] | null | undefined, b: number[] | null | undefined): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return Math.max(0, Math.min(1, dot));
}
