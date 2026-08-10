const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Short, collision-resistant, URL-safe id. */
export function newId(prefix?: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return prefix ? `${prefix}_${out}` : out;
}

/** Longer opaque token for candidate interview links. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
