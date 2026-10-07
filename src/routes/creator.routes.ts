import { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/authenticate";
import { authorize } from "../middleware/authorize";
import { asyncHandler } from "../utils/asyncHandler";
import {
  uploadSoftware, getMySoftware, getMyEarnings,
  updateSoftware, deleteSoftware, getMyPayoutDetails, updateMyPayoutDetails,
  replaceSoftwarePdf,
} from "../controllers/creator.controller";

export default async function creatorRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", authorize("creator"));

  app.post("/software", asyncHandler(uploadSoftware));
  app.get("/software", asyncHandler(getMySoftware));
  app.get("/earnings", asyncHandler(getMyEarnings));
  app.get("/payout", asyncHandler(getMyPayoutDetails));
  app.put("/payout", asyncHandler(updateMyPayoutDetails));
  app.patch("/software/:id", asyncHandler(updateSoftware));
  app.put("/software/:id/pdf", asyncHandler(replaceSoftwarePdf));
  app.delete("/software/:id", asyncHandler(deleteSoftware));
}