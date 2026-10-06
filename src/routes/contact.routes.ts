import { FastifyInstance } from "fastify";
import { submitContactRequest } from "../controllers/contact.controller";
import { asyncHandler } from "../utils/asyncHandler";

export default async function contactRoutes(app: FastifyInstance) {
  app.post("/", asyncHandler(submitContactRequest));
}
