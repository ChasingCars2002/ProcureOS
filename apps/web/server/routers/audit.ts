import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { router, financeProcedure } from "@/lib/trpc/init";
import { db, auditLogs } from "@flowprocure/db";

export const auditRouter = router({
  listLogs: financeProcedure
    .input(
      z.object({
        entityType: z.string().optional(),
        entityId: z.string().uuid().optional(),
        eventType: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(100),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const conditions = [];
      if (input.entityType) conditions.push(eq(auditLogs.entityType, input.entityType));
      if (input.entityId) conditions.push(eq(auditLogs.entityId, input.entityId));
      if (input.eventType) conditions.push(eq(auditLogs.eventType, input.eventType));

      return db.query.auditLogs.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        with: { actor: true },
        orderBy: desc(auditLogs.createdAt),
        limit: input.limit,
        offset: input.offset,
      });
    }),
});
