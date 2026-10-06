import { FastifyInstance } from "fastify";
import authRoutes from "./auth.routes";
import creatorRoutes from "./creator.routes";
import buyerRoutes from "./buyer.routes";
import adminRoutes from "./admin.routes";
import contactRoutes from "./contact.routes";

export default async function registerRoutes(app: FastifyInstance) {
  app.register(contactRoutes, { prefix: "/api/contact" });
  app.register(authRoutes, { prefix: "/api/auth" });
  app.register(creatorRoutes, { prefix: "/api/creator" });
  app.register(buyerRoutes, { prefix: "/api/buyer" });
  app.register(adminRoutes, { prefix: "/api/admin" });
}