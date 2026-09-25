import "./_setup.js";
import test from "node:test";
import assert from "node:assert";

const { pdfToText } = await import("../src/pdfText.js");

/** Minimal, to'g'ri tuzilgan bir sahifali PDF (xref ofsetlari hisoblanadi). */
function makePdf(text) {
  const stream = `BT /F1 18 Tf 50 750 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

test("PDF'dan matn ajratiladi, asl bufer o'zgarmaydi", async () => {
  const buf = makePdf("Narxlar: ko'ylak 150000 som");
  const copy = Buffer.from(buf);
  const text = await pdfToText(buf);
  assert.match(text, /^Narxlar: ko['’]ylak 150000 som$/);
  assert.ok(buf.equals(copy));
});

test("buzilgan PDF xato beradi (server yiqilmaydi)", async () => {
  await assert.rejects(pdfToText(Buffer.from("bu pdf emas")));
});
