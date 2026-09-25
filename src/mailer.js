/**
 * Platforma xatlari (parolni tiklash, email tasdiqlash, obuna eslatmalari).
 * .env: SMTP_HOST, SMTP_PORT (465), SMTP_USER, SMTP_PASS, SMTP_FROM ("Obunext <no-reply@obunext.uz>").
 * Sozlanmagan bo'lsa xat yuborilmaydi — chaqiruvchi Telegram kabi boshqa yo'lni tanlaydi.
 */
import nodemailer from "nodemailer";

let transport = null;
let sentForTests = null;

export const mailReady = () => Boolean(sentForTests || (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS));

/** Testlar uchun: xatlar yuborilmaydi, massivga yig'iladi. */
export function captureMail(list) {
  sentForTests = list;
}

function getTransport() {
  if (transport) return transport;
  const port = Number(process.env.SMTP_PORT) || 465;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000,
  });
  return transport;
}

const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Oddiy brendlangan xat: sarlavha, matn qatorlari va (ixtiyoriy) tugma. */
export async function sendPlatformMail(to, { subject, lines = [], button = null }) {
  if (!mailReady() || !to) return false;
  const text = [...lines, button ? `${button.label}: ${button.url}` : ""].filter(Boolean).join("\n\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
    <div style="font-size:20px;font-weight:800;margin-bottom:16px">Obunext</div>
    ${lines.map((l) => `<p style="font-size:15px;line-height:1.6;margin:0 0 12px">${escHtml(l)}</p>`).join("")}
    ${button ? `<p style="margin:22px 0"><a href="${escHtml(button.url)}" style="background:#7c3aed;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;display:inline-block">${escHtml(button.label)}</a></p>` : ""}
    <p style="font-size:12px;color:#888;margin-top:28px">Bu xat Obunext tomonidan avtomatik yuborildi.</p></div>`;
  const msg = { from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text, html };
  if (sentForTests) {
    sentForTests.push(msg);
    return true;
  }
  try {
    await getTransport().sendMail(msg);
    return true;
  } catch (err) {
    console.error("[Email] yuborilmadi:", err.message);
    return false;
  }
}
