import { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/authenticate";
import { authorize } from "../middleware/authorize";
import { asyncHandler } from "../utils/asyncHandler";
import {
  uploadSoftware, getMySoftware, getMyEarnings,
  updateSoftware, deleteSoftware,
} from "../controllers/creator.controller";

export default async function creatorRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", authorize("creator"));

  app.post("/software", asyncHandler(uploadSoftware));
  app.get("/software", asyncHandler(getMySoftware));
  app.get("/earnings", asyncHandler(getMyEarnings));
  app.patch("/software/:id", asyncHandler(updateSoftware));
  app.delete("/software/:id", asyncHandler(deleteSoftware));
}