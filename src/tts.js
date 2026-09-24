// Google Cloud Text-to-Speech orqali matnni MP3 ovozga aylantiradi.
// GOOGLE_TTS_API_KEY berilgan bo'lsagina ishlaydi (ixtiyoriy).

const ttsKey = process.env.GOOGLE_TTS_API_KEY || "";
const TTS_VOICE = process.env.TTS_VOICE || ""; // masalan: uz-UZ-Standard-A
const TTS_LANG = process.env.TTS_LANG || "uz-UZ";

export const ttsAvailable = Boolean(ttsKey);

/**
 * Matnni MP3 ovozga aylantiradi. Buffer qaytaradi yoki xato bo'lsa null.
 * WhatsApp voice uchun juda uzun matn kesiladi.
 */
export async function synthesize(text) {
  if (!ttsKey || !text) return null;
  const clipped = text.slice(0, 600);

  try {
    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${ttsKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text: clipped },
          voice: TTS_VOICE
            ? { languageCode: TTS_LANG, name: TTS_VOICE }
            : { languageCode: TTS_LANG },
          audioConfig: { audioEncoding: "MP3" },
        }),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.audioContent) {
      console.error("TTS xatosi:", JSON.stringify(data.error || data).slice(0, 200));
      return null;
    }
    return Buffer.from(data.audioContent, "base64");
  } catch (err) {
    console.error("TTS so'rovida xato:", err.message);
    return null;
  }
}
