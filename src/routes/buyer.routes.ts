import { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/authenticate";
import { authorize } from "../middleware/authorize";
import { asyncHandler } from "../utils/asyncHandler";
import {
  browseSoftware, getSoftwareDetails, getMyPurchases, getPurchasedSoftwarePdf,
  getPurchasedSoftwareArchive,
} from "../controllers/buyer.controller";
import { initiatePayment, verifyPayment } from "../controllers/payment.controller";

export default async function buyerRoutes(app: FastifyInstance) {
  // Public browsing
  app.get("/software", asyncHandler(browseSoftware));
  app.get("/software/:id", asyncHandler(getSoftwareDetails));

  // Protected (buyer only)
  app.register(async (protectedApp) => {
    protectedApp.addHook("preHandler", authenticate);
    protectedApp.addHook("preHandler", authorize("buyer"));

    protectedApp.get("/purchases", asyncHandler(getMyPurchases));
    protectedApp.get("/purchases/:id/pdf", asyncHandler(getPurchasedSoftwarePdf));
    protectedApp.get("/purchases/:id/project-archive", asyncHandler(getPurchasedSoftwareArchive));
    protectedApp.post("/payment/initiate", asyncHandler(initiatePayment));
    protectedApp.post("/payment/verify", asyncHandler(verifyPayment));
  });
}