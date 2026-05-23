import { router } from "@/lib/trpc/init";
import { requestsRouter } from "./routers/requests";
import { approvalsRouter } from "./routers/approvals";
import { vendorsRouter } from "./routers/vendors";
import { policiesRouter } from "./routers/policies";
import { erpRouter } from "./routers/erp";
import { auditRouter } from "./routers/audit";

export const appRouter = router({
  requests: requestsRouter,
  approvals: approvalsRouter,
  vendors: vendorsRouter,
  policies: policiesRouter,
  erp: erpRouter,
  audit: auditRouter,
});

export type AppRouter = typeof appRouter;
