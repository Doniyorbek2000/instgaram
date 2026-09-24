/**
 * Obunext — Vector Search (RAG - Retrieval-Augmented Generation) Engine
 * Katta bilimlar bazasini bo'laklarga (chunking) ajratadi va mijoz savoliga eng yaqin 
 * bilim bo'laklarini (Cosine Similarity / Vector Match) topib beradi.
 */

/**
 * Matnni mantiqiy bo'laklarga (chunks) ajratadi (paragraf yoki 500-800 belgi bo'yicha)
 */
export function chunkText(text, maxChunkSize = 700) {
  if (!text || typeof text !== "string") return [];
  const clean = text.trim();
  if (clean.length <= maxChunkSize) return [clean];

  // Paragraflar yoki yangi qator bo'yicha bo'lish
  const paragraphs = clean.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let currentChunk = "";

  for (const para of paragraphs) {
    if ((currentChunk + "\n\n" + para).length <= maxChunkSize) {
      currentChunk = currentChunk ? currentChunk + "\n\n" + para : para;
    } else {
      if (currentChunk) chunks.push(currentChunk);
      if (para.length > maxChunkSize) {
        // Agar bir paragrafning o'zi juda katta bo me'moriy bo'lsa jumlalar bo'yicha bo'lish
        const sentences = para.match(/[^.!?]+[.!?]+/g) || [para];
        let subChunk = "";
        for (const sent of sentences) {
          if ((subChunk + " " + sent).length <= maxChunkSize) {
            subChunk = subChunk ? subChunk + " " + sent : sent;
          } else {
            if (subChunk) chunks.push(subChunk.trim());
            subChunk = sent;
          }
        }
        if (subChunk) chunks.push(subChunk.trim());
      } else {
        currentChunk = para;
      }
    }
  }
  if (currentChunk) chunks.push(currentChunk);

  return chunks;
}

/**
 * Matndan TF-IDF so'z chastotasi (Embedding Vector Map) hosil qiladi
 */
export function createWordVector(text) {
  const words = String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(w => w.length > 2);

  const freqMap = new Map();
  for (const w of words) {
    freqMap.set(w, (freqMap.get(w) || 0) + 1);
  }
  return freqMap;
}

/**
 * Ikki so'z vektori orasidagi Kosinus O'xshashligini (Cosine Similarity 0.0 - 1.0) hisoblaydi
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.size === 0 || vecB.size === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const val of vecA.values()) {
    normA += val * val;
  }
  for (const val of vecB.values()) {
    normB += val * val;
  }

  for (const [word, countA] of vecA.entries()) {
    if (vecB.has(word)) {
      dotProduct += countA * vecB.get(word);
    }
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Vector Search: Mijoz savoliga eng mos 3 ta bilim bo'lagini ajratib oladi
 */
export function findRelevantChunks(businessInfo, query, topK = 3) {
  if (!businessInfo) return "";
  const chunks = chunkText(businessInfo);
  if (chunks.length <= topK) return chunks.join("\n\n---\n\n");

  const queryVec = createWordVector(query);
  if (queryVec.size === 0) return chunks.slice(0, topK).join("\n\n---\n\n");

  const scored = chunks.map(chunk => {
    const chunkVec = createWordVector(chunk);
    const score = cosineSimilarity(queryVec, chunkVec);
    return { chunk, score };
  });

  // Reyting bo'yicha tartiblash (eng o'xshashlar yuqorida)
  scored.sort((a, b) => b.score - a.score);

  // Eng mos Top K ta bo'lakni tanlash
  const selected = scored.slice(0, topK).map(s => s.chunk);
  return selected.join("\n\n---\n\n");
}
