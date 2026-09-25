// PDF'dan matn ajratish (AI bilim bazasiga hujjat yuklash). pdf-parse 2.x (pdf.js asosida).
import { PDFParse } from "pdf-parse";

export async function pdfToText(buffer) {
  // pdf.js berilgan xotirani "detach" qilishi mumkin — asl buferga tegmasligi uchun nusxa
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    // pageJoiner: v2 standart holatda "-- 1 of N --" belgisini qo'shadi — bilim bazasiga kerak emas
    const result = await parser.getText({ pageJoiner: "" });
    return (result.text || "").trim();
  } finally {
    await parser.destroy();
  }
}
