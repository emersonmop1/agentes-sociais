/**
 * Stopwords stripped during keyword extraction for the RECALL stage of
 * memory search. Keep small — over-aggressive removal hurts recall on
 * short queries.
 *
 * Direct port of clubhub §7.2 stopwords list.
 */
const PT = new Set([
  "a", "o", "e", "de", "do", "da", "em", "um", "uma", "para", "com", "nao",
  "não", "que", "os", "as", "por", "mais", "na", "no", "se", "eu", "ele",
  "ela", "isso", "este", "esta", "como", "mas", "foi", "ao", "dos", "das",
  "seu", "sua", "ou", "ser", "quando", "muito", "nos", "também", "tambem",
  "pelo", "pela", "pode", "aqui", "à", "às", "é", "são", "tem", "ter",
]);

const EN = new Set([
  "the", "is", "are", "was", "an", "in", "on", "to", "and", "or", "but",
  "for", "with", "not", "you", "he", "of", "a", "i", "be", "this", "that",
  "it", "as", "at", "by", "from", "have", "has", "had", "do", "does",
]);

const STOPWORDS = new Set<string>([...PT, ...EN]);

/** Lowercase, split, drop stopwords + tokens ≤ 2 chars, return up to N keywords. */
export function extractKeywords(text: string, max = 10): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .slice(0, max);
}
