import { FastifyInstance } from "fastify";
import { submitContactRequest } from "../controllers/contact.controller";
import { authenticate } from "../middleware/authenticate";
import { asyncHandler } from "../utils/asyncHandler";

export default async function contactRoutes(app: FastifyInstance) {
  app.post("/", { preHandler: authenticate }, asyncHandler(submitContactRequest));
}
