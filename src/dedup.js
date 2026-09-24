// Meta ba'zan bitta webhook xabarni bir necha marta yuboradi.
// Ko'rilgan xabar ID'larini eslab, takroriy javob berishning oldini olamiz.

const seen = new Map(); // id -> vaqt (ms)
const TTL_MS = 10 * 60 * 1000; // 10 daqiqa
const MAX = 5000;

/** Xabar allaqachon ko'rilgan bo'lsa true (o'tkazib yuborish kerak) qaytaradi. */
export function isDuplicate(id) {
  if (!id) return false;
  const now = Date.now();

  // Eskilarini vaqti-vaqti bilan tozalab turamiz
  if (seen.size > MAX) {
    for (const [key, ts] of seen) {
      if (now - ts > TTL_MS) seen.delete(key);
    }
  }

  const prev = seen.get(id);
  if (prev && now - prev < TTL_MS) return true;
  seen.set(id, now);
  return false;
}
