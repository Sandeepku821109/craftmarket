import { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/authenticate";
import { authorize } from "../middleware/authorize";
import { asyncHandler } from "../utils/asyncHandler";
import {
  getDashboardStats, getAllUsers, updateUserRole, getAllSoftware,
  getSoftwarePdf, getSoftwareArchive, approveSoftware, rejectSoftware, getCreatorEarnings, getAllOrders,
  getContactSubmissions, updateContactSubmissionStatus, deleteContactSubmission,
  markCreatorPayoutPaid,
} from "../controllers/admin.controller";

export default async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", authorize("admin"));

  app.get("/dashboard", asyncHandler(getDashboardStats));
  app.get("/users", asyncHandler(getAllUsers));
  app.patch("/users/:id/role", asyncHandler(updateUserRole));
  app.get("/software", asyncHandler(getAllSoftware));
  app.get("/software/:id/pdf", asyncHandler(getSoftwarePdf));
  app.get("/software/:id/project-archive", asyncHandler(getSoftwareArchive));
  app.patch("/software/:id/approve", asyncHandler(approveSoftware));
  app.patch("/software/:id/reject", asyncHandler(rejectSoftware));
  app.get("/creator/:id/earnings", asyncHandler(getCreatorEarnings));
  app.get("/orders", asyncHandler(getAllOrders));
  app.patch("/orders/:id/payout", asyncHandler(markCreatorPayoutPaid));
  app.get("/contact-submissions", asyncHandler(getContactSubmissions));
  app.patch("/contact-submissions/:id", asyncHandler(updateContactSubmissionStatus));
  app.delete("/contact-submissions/:id", asyncHandler(deleteContactSubmission));
}