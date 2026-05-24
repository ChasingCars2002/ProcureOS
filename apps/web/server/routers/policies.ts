import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "@/lib/trpc/init";
import {
  db,
  approvalPolicies,
  auditLogs,
  policyConditionsSchema,
  policyActionsZodSchema,
} from "@flowprocure/db";
import {
  buildApprovalChain,
  previewApprovalChain,
  type EvaluationContext,
} from "@flowprocure/policy-engine";

const policyInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  priority: z.number().int().positive(),
  conditions: policyConditionsSchema,
  actions: policyActionsZodSchema,
});

export const policiesRouter = router({
  list: protectedProcedure.query(async () => {
    return db.query.approvalPolicies.findMany({
      with: { creator: true },
      orderBy: approvalPolicies.priority,
    });
  }),

  create: adminProcedure
    .input(policyInput)
    .mutation(async ({ input, ctx }) => {
      const [policy] = await db
        .insert(approvalPolicies)
        .values({ ...input, createdBy: ctx.user.id })
        .returning();

      await db.insert(auditLogs).values({
        eventType: "policy.created",
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        entityType: "approval_policy",
        entityId: policy.id,
        afterState: { name: policy.name, priority: policy.priority } as Record<string, unknown>,
      });

      return policy;
    }),

  update: adminProcedure
    .input(z.object({ id: z.string().uuid() }).merge(policyInput.partial()))
    .mutation(async ({ input, ctx }) => {
      const { id, ...updates } = input;
      const existing = await db.query.approvalPolicies.findFirst({
        where: eq(approvalPolicies.id, id),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      const [updated] = await db.update(approvalPolicies)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(approvalPolicies.id, id))
        .returning();

      await db.insert(auditLogs).values({
        eventType: "policy.updated",
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        entityType: "approval_policy",
        entityId: id,
        beforeState: existing as unknown as Record<string, unknown>,
        afterState: updated as unknown as Record<string, unknown>,
      });

      return updated;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await db.query.approvalPolicies.findFirst({
        where: eq(approvalPolicies.id, input.id),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      // Soft delete: set is_active = false
      await db.update(approvalPolicies)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(approvalPolicies.id, input.id));

      await db.insert(auditLogs).values({
        eventType: "policy.deactivated",
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        entityType: "approval_policy",
        entityId: input.id,
        beforeState: { isActive: true } as Record<string, unknown>,
        afterState: { isActive: false } as Record<string, unknown>,
      });

      return { success: true };
    }),

  preview: protectedProcedure
    .input(
      z.object({
        totalAmount: z.number().nonnegative(),
        departmentId: z.string().uuid(),
        vendorIsNew: z.boolean().default(false),
        vendorComplianceReviewed: z.boolean().default(true),
        requesterRole: z.string().default("requester"),
      })
    )
    .query(async ({ input, ctx }) => {
      const policies = await db.query.approvalPolicies.findMany({
        where: eq(approvalPolicies.isActive, true),
        orderBy: approvalPolicies.priority,
      });

      const policyRecords = policies.map((p) => ({
        id: p.id,
        priority: p.priority,
        conditions: p.conditions,
        actions: p.actions,
      }));

      const evalCtx: EvaluationContext = {
        totalAmount: input.totalAmount,
        departmentId: input.departmentId,
        vendorIsNew: input.vendorIsNew,
        vendorComplianceReviewed: input.vendorComplianceReviewed,
        requesterId: ctx.user.id,
        requesterRole: input.requesterRole,
      };

      const { matchedPolicyIds, steps } = previewApprovalChain(
        policyRecords,
        evalCtx
      );

      const matchedPolicies = policies.filter((p) =>
        matchedPolicyIds.includes(p.id)
      );

      return {
        matchedPolicies: matchedPolicies.map((p) => ({
          id: p.id,
          name: p.name,
          priority: p.priority,
        })),
        steps,
        totalSteps: steps.length,
        autoApproved: steps.length === 0,
      };
    }),
});
