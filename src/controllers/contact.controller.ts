import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { sendContactEmail } from "../services/notification.service";
import { sendError, sendSuccess } from "../utils/apiResponse";
import { ContactSubmissionModel } from "../models/ContactSubmission.model";

const contactSchema = z.object({
  name: z.string().trim().min(1).max(100).refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
  phone: z.string().trim()
    .regex(/^\+?[0-9().\s-]{7,25}$/, "Enter a valid phone number")
    .refine((value) => (value.match(/\d/g) || []).length >= 7 && (value.match(/\d/g) || []).length <= 15),
  email: z.string().trim().email().max(254),
  subject: z.enum([
    "General question",
    "Buying a product",
    "Selling on Craftmarket",
    "Report a problem",
    "Something else",
  ]),
  query: z.string().trim().min(10).max(5000),
});

export async function submitContactRequest(req: FastifyRequest, reply: FastifyReply) {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(reply, "Please provide valid contact details and a query of at least 10 characters.", 400, parsed.error.flatten());
  }

  await ContactSubmissionModel.create(parsed.data);
  let notificationSent = true;
  try {
    await sendContactEmail(parsed.data);
  } catch (error) {
    notificationSent = false;
    req.log.error({ err: error }, "Contact query saved, but its email notification could not be sent");
  }

  return sendSuccess(
    reply,
    { notificationSent },
    notificationSent
      ? "Your message has been sent. We’ll get back to you soon."
      : "Your query was saved for the support team, but its email notification could not be sent.",
    201
  );
}
