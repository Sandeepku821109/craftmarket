import nodemailer from "nodemailer";
import { ENV } from "../config/env";

const transporter = nodemailer.createTransport({
  host: ENV.SMTP_HOST,
  port: ENV.SMTP_PORT,
  secure: ENV.SMTP_PORT === 465,
  auth: { user: ENV.SMTP_USER, pass: ENV.SMTP_PASS },
});

const BRAND_NAME = "Craftmarket";
const OTP_EXPIRY_MINUTES = 5;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function createOtpEmail(otp: string): { html: string; text: string } {
  const safeOtp = escapeHtml(otp);
  const year = new Date().getFullYear();

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>Your ${BRAND_NAME} sign-in code</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f5f5ef;font-family:Arial,Helvetica,sans-serif;color:#292c25;">
    <div style="display:none;font-size:1px;color:#f5f5ef;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Your ${BRAND_NAME} verification code is ${safeOtp}. It expires in ${OTP_EXPIRY_MINUTES} minutes.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f5f5ef;padding:36px 14px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">
          <tr><td style="padding:0 0 18px 2px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td align="center" valign="middle" width="36" height="36" style="width:36px;height:36px;background-color:#c7ec9b;border-radius:10px;color:#35462a;font-size:19px;font-weight:bold;">✳</td>
                <td style="padding-left:10px;color:#292c25;font-size:19px;font-weight:700;letter-spacing:-0.6px;">craft<span style="color:#92958a;">market</span></td>
              </tr>
            </table>
          </td></tr>
          <tr><td style="background-color:#ffffff;border:1px solid #e8e9e1;border-radius:12px;padding:38px 36px 32px;">
            <p style="margin:0 0 12px;color:#748363;font-size:10px;line-height:16px;font-weight:bold;letter-spacing:1.5px;">ONE QUICK SECURITY CHECK</p>
            <h1 style="margin:0 0 13px;color:#292c25;font-size:27px;line-height:34px;letter-spacing:-0.8px;">Your sign-in code is here.</h1>
            <p style="margin:0 0 25px;color:#77796f;font-size:14px;line-height:23px;">Enter this one-time code to continue. For your security, it expires in ${OTP_EXPIRY_MINUTES} minutes.</p>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;">
              <tr><td style="background-color:#f4f6ef;border:1px solid #e8ecdf;border-radius:9px;padding:17px 23px;color:#292c25;font-family:Arial,Helvetica,sans-serif;font-size:31px;line-height:38px;font-weight:bold;letter-spacing:9px;">${safeOtp}</td></tr>
            </table>
            <p style="margin:0 0 20px;color:#77796f;font-size:12px;line-height:20px;">If you didn’t request this code, you can safely ignore this email. Your account remains secure.</p>
            <div style="height:1px;background-color:#eeeeea;margin:0 0 17px;"></div>
            <p style="margin:0;color:#999b92;font-size:11px;line-height:18px;">A little less noise, a little more good work.</p>
          </td></tr>
          <tr><td align="center" style="padding:18px 8px 0;color:#999b92;font-size:10px;line-height:17px;">
            This is an automated message from ${BRAND_NAME}. Please don’t reply.<br>
            &copy; ${year} ${BRAND_NAME}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = [
    `${BRAND_NAME} sign-in code`,
    "",
    `Your one-time verification code is: ${otp}`,
    `It expires in ${OTP_EXPIRY_MINUTES} minutes.`,
    "",
    "If you didn’t request this code, you can safely ignore this email. Your account remains secure.",
    "",
    `A little less noise, a little more good work.`,
    `© ${year} ${BRAND_NAME}`,
  ].join("\n");

  return { html, text };
}

export async function sendOtpEmail(email: string, otp: string) {
  if (!/^\d{6}$/.test(otp)) {
    throw new Error("OTP email requires a six-digit code");
  }

  const content = createOtpEmail(otp);
  await transporter.sendMail({
    from: `"${BRAND_NAME}" <${ENV.SMTP_USER}>`,
    to: email,
    subject: `Your ${BRAND_NAME} sign-in code`,
    text: content.text,
    html: content.html,
  });
}

export async function sendContactEmail(contact: {
  name: string;
  phone: string;
  email: string;
  subject: string;
  query: string;
}) {
  const safeName = escapeHtml(contact.name);
  const safePhone = escapeHtml(contact.phone);
  const safeEmail = escapeHtml(contact.email);
  const safeSubject = escapeHtml(contact.subject);
  const safeQuery = escapeHtml(contact.query).replace(/\r?\n/g, "<br>");
  const year = new Date().getFullYear();

  await transporter.sendMail({
    from: `"${BRAND_NAME}" <${ENV.SMTP_USER}>`,
    to: ENV.CONTACT_EMAIL || ENV.SMTP_USER,
    replyTo: { name: contact.name, address: contact.email },
    subject: `[${BRAND_NAME} Contact] ${contact.subject}`,
    text: [
      `Contact request: ${contact.subject}`,
      "",
      `Name: ${contact.name}`,
      `Phone: ${contact.phone}`,
      `Email: ${contact.email}`,
      "",
      "Query:",
      contact.query,
    ].join("\n"),
    html: `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${BRAND_NAME} contact request</title></head>
  <body style="margin:0;padding:32px 14px;background:#f5f5ef;font-family:Arial,Helvetica,sans-serif;color:#292c25;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;margin:auto;background:#fff;border:1px solid #e8e9e1;border-radius:12px;">
      <tr><td style="padding:30px;">
        <p style="margin:0 0 10px;color:#748363;font-size:11px;font-weight:bold;letter-spacing:1px;">${BRAND_NAME} CONTACT REQUEST</p>
        <h1 style="margin:0 0 22px;font-size:23px;">${safeSubject}</h1>
        <p style="margin:0 0 8px;"><strong>Name:</strong> ${safeName}</p>
        <p style="margin:0 0 8px;"><strong>Phone:</strong> ${safePhone}</p>
        <p style="margin:0 0 22px;"><strong>Email:</strong> ${safeEmail}</p>
        <div style="padding:16px;background:#f5f6f1;border-radius:8px;line-height:1.7;">${safeQuery}</div>
        <p style="margin:22px 0 0;color:#999b92;font-size:11px;">Received via the Craftmarket contact form · ${year}</p>
      </td></tr>
    </table>
  </body>
</html>`,
  });
}