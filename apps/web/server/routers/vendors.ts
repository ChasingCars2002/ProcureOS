import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, financeProcedure } from "@/lib/trpc/init";
import { db, vendors, auditLogs } from "@flowprocure/db";

export const vendorsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        isNew: z.boolean().optional(),
        complianceReviewed: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      return db.query.vendors.findMany({
        where: input.isNew !== undefined
          ? eq(vendors.isNew, input.isNew)
          : undefined,
        with: { complianceReviewer: true },
        orderBy: vendors.name,
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const vendor = await db.query.vendors.findFirst({
        where: eq(vendors.id, input.id),
        with: { complianceReviewer: true },
      });
      if (!vendor) throw new TRPCError({ code: "NOT_FOUND" });
      return vendor;
    }),

  create: financeProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        ein: z.string().optional(),
        contactEmail: z.string().email().optional(),
        contactPhone: z.string().optional(),
        paymentTerms: z.string().optional(),
        preferredErpVendorId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [vendor] = await db.insert(vendors).values(input).returning();

      await db.insert(auditLogs).values({
        eventType: "vendor.created",
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        entityType: "vendor",
        entityId: vendor.id,
        afterState: { name: vendor.name, isNew: true } as Record<string, unknown>,
      });

      return vendor;
    }),

  update: financeProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        ein: z.string().optional(),
        contactEmail: z.string().email().optional(),
        contactPhone: z.string().optional(),
        paymentTerms: z.string().optional(),
        preferredErpVendorId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...updates } = input;
      const existing = await db.query.vendors.findFirst({
        where: eq(vendors.id, id),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      const [updated] = await db.update(vendors)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(vendors.id, id))
        .returning();

      await db.insert(auditLogs).values({
        eventType: "vendor.updated",
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        entityType: "vendor",
        entityId: id,
        beforeState: existing as unknown as Record<string, unknown>,
        afterState: updated as unknown as Record<string, unknown>,
      });

      return updated;
    }),

  markComplianceReviewed: financeProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await db.query.vendors.findFirst({
        where: eq(vendors.id, input.id),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      const [updated] = await db.update(vendors)
        .set({
          complianceReviewed: true,
          isNew: false,
          complianceReviewedBy: ctx.user.id,
          complianceReviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(vendors.id, input.id))
        .returning();

      await db.insert(auditLogs).values({
        eventType: "vendor.compliance_reviewed",
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        entityType: "vendor",
        entityId: input.id,
        beforeState: { isNew: existing.isNew, complianceReviewed: existing.complianceReviewed } as Record<string, unknown>,
        afterState: { isNew: false, complianceReviewed: true } as Record<string, unknown>,
      });

      return updated;
    }),
});
