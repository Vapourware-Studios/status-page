import { Hono } from "hono";
import type { Env } from "../../types";
import { requireAdmin } from "../../auth";
import { monitorsAdminRouter } from "./monitors";
import { incidentsAdminRouter } from "./incidents";
import { settingsAdminRouter } from "./settings";
import { webhooksAdminRouter } from "./webhooks";
import { maintenanceAdminRouter } from "./maintenance";
import { groupsAdminRouter } from "./groups";
import { usersAdminRouter } from "./users";

export const adminRouter = new Hono<{ Bindings: Env }>();

adminRouter.use("/*", requireAdmin);

adminRouter.route("/monitors", monitorsAdminRouter);
adminRouter.route("/incidents", incidentsAdminRouter);
adminRouter.route("/settings", settingsAdminRouter);
adminRouter.route("/webhooks", webhooksAdminRouter);
adminRouter.route("/maintenance", maintenanceAdminRouter);
adminRouter.route("/groups", groupsAdminRouter);
adminRouter.route("/users", usersAdminRouter);
