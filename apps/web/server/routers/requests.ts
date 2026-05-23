import { z } from "zod";
import { eq, desc, and, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, financeProcedure } from "@/lib/trpc/init";
import {
  db,
  purchaseRequests,
  lineItems,
  approvalPolicies,
  approvalSteps,
  approvalAssignments,
  users,
  vendors,
  departments,
  auditLogs,
  erpSyncJobs,
  type RequestStatus,
} from "@flowprocure/db";
import {
  buildApprovalChain,
  type EvaluationContext,
} from "@flowprocure/policy-engine";

async function insertAuditLog(params: {
  eventType: string;
  actorId: string;
  actorRole: string;
  entityType: string;
  entityId: string;
  beforeState?: unknown;
  afterState?: unknown;
}) {
  await db.insert(auditLogs).values({
    eventType: params.eventType,
    actorId: params.actorId,
    actorRole: params.actorRole,
    entityType: "purchase_request",
    entityId: params.entityId,
    beforeState: params.beforeState as Record<string, unknown> ?? null,
    afterState: params.afterState as Record<string, unknown> ?? null,
  });
}

export const requestsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        status: z
          .enum([
            "draft",
            "pending_approval",
            "approved",
            "rejected",
            "cancelled",
            "ordered",
            "received",
          ] as const)
          .optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      const conditions = [];

      // Non-admin/finance users only see their own requests
      if (!["finance", "admin"].includes(ctx.user.role)) {
        conditions.push(eq(purchaseRequests.requesterId, ctx.user.id));
      }
      if (input.status) {
        conditions.push(eq(purchaseRequests.status, input.status));
      }

      return db.query.purchaseRequests.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        with: { requester: true, department: true, vendor: true },
        orderBy: desc(purchaseRequests.createdAt),
        limit: input.limit,
        offset: input.offset,
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const request = await db.query.purchaseRequests.findFirst({
        where: eq(purchaseRequests.id, input.id),
        with: {
          requester: true,
          department: true,
          vendor: true,
          lineItems: true,
        },
      });

      if (!request) throw new TRPCError({ code: "NOT_FOUND" });

      // Access control: only requester, assigned approvers, finance, admin
      const isOwner = request.requesterId === ctx.user.id;
      const isFinanceOrAdmin = ["finance", "admin"].includes(ctx.user.role);
      if (!isOwner && !isFinanceOrAdmin) {
        const assignment = await db.query.approvalAssignments.findFirst({
          where: and(
            eq(approvalAssignments.assigneeId, ctx.user.id)
          ),
          with: {
            step: true,
          },
        });
        const isAssigned =
          assignment &&
          (assignment.step as { requestId: string }).requestId === input.id;
        if (!isAssigned) throw new TRPCError({ code: "FORBIDDEN" });
      }

      return request;
    }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        departmentId: z.string().uuid(),
        vendorId: z.string().uuid().optional(),
        currency: z.string().length(3).default("USD"),
        neededByDate: z.string().optional(),
        businessJustification: z.string().max(2000).optional(),
        lineItems: z
          .array(
            z.object({
              description: z.string().min(1),
              quantity: z.number().positive(),
              unitPrice: z.number().positive(),
              glAccountCode: z.string().optional(),
            })
          )
          .min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return db.transaction(async (tx) => {
        const [request] = await tx
          .insert(purchaseRequests)
          .values({
            title: input.title,
            description: input.description,
            requestNumber: "", // Set by DB trigger
            requesterId: ctx.user.id,
            departmentId: input.departmentId,
            vendorId: input.vendorId,
            currency: input.currency,
            neededByDate: input.neededByDate,
            businessJustification: input.businessJustification,
            status: "draft",
          })
          .returning();

        await tx.insert(lineItems).values(
          input.lineItems.map((item) => ({
            requestId: request.id,
            description: item.description,
            quantity: String(item.quantity),
            unitPrice: String(item.unitPrice),
            glAccountCode: item.glAccountCode,
          }))
        );

        await tx.insert(auditLogs).values({
          eventType: "request.created",
          actorId: ctx.user.id,
          actorRole: ctx.user.role,
          entityType: "purchase_request",
          entityId: request.id,
          afterState: { status: "draft", title: request.title } as Record<string, unknown>,
        });

        return request;
      });
    }),

  submit: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const request = await db.query.purchaseRequests.findFirst({
        where: and(
          eq(purchaseRequests.id, input.id),
          eq(purchaseRequests.requesterId, ctx.user.id),
          eq(purchaseRequests.status, "draft")
        ),
        with: { vendor: true, lineItems: true },
      });

      if (!request) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Draft request not found or already submitted",
        });
      }

      // Build evaluation context
      const evalCtx: EvaluationContext = {
        totalAmount: Number(request.totalAmount),
        departmentId: request.departmentId,
        vendorIsNew: request.vendor?.isNew ?? false,
        vendorComplianceReviewed: request.vendor?.complianceReviewed ?? true,
        requesterId: ctx.user.id,
        requesterRole: ctx.user.role,
      };

      // Fetch all active policies
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

      const resolvedSteps = buildApprovalChain(policyRecords, evalCtx);

      return db.transaction(async (tx) => {
        if (resolvedSteps.length === 0) {
          // No approval required — auto-approve
          await tx
            .update(purchaseRequests)
            .set({ status: "approved", updatedAt: new Date() })
            .where(eq(purchaseRequests.id, input.id));

          await tx.insert(auditLogs).values({
            eventType: "request.auto_approved",
            actorId: ctx.user.id,
            actorRole: ctx.user.role,
            entityType: "purchase_request",
            entityId: input.id,
            afterState: { status: "approved" } as Record<string, unknown>,
          });

          return { status: "approved" as RequestStatus, steps: 0 };
        }

        // Create approval steps and assignments
        for (const step of resolvedSteps) {
          const [approvalStep] = await tx
            .insert(approvalSteps)
            .values({
              requestId: input.id,
              policyId: step.policyId,
              stepNumber: step.stepNumber,
              label: step.label,
              requiresAll: step.requiresAll,
              status: "pending",
            })
            .returning();

          // Resolve assignees based on type
          let assigneeIds: string[] = [];

          if (step.assigneeType === "user") {
            assigneeIds = [step.assigneeValue];
          } else if (step.assigneeType === "role") {
            const roleUsers = await tx
              .select({ id: users.id })
              .from(users)
              .where(
                and(
                  eq(users.role, step.assigneeValue as "requester" | "approver" | "finance" | "admin"),
                  eq(users.isActive, true)
                )
              );
            assigneeIds = roleUsers.map((u) => u.id);
          } else if (step.assigneeType === "department_budget_owner") {
            const dept = await tx.query.departments.findFirst({
              where: eq(departments.id, request.departmentId),
            });
            if (dept?.budgetOwnerId) {
              assigneeIds = [dept.budgetOwnerId];
            }
          }

          if (assigneeIds.length > 0) {
            await tx.insert(approvalAssignments).values(
              assigneeIds.map((assigneeId) => ({
                stepId: approvalStep.id,
                assigneeId,
                decision: "pending" as const,
              }))
            );
          }
        }

        await tx
          .update(purchaseRequests)
          .set({
            status: "pending_approval",
            currentApprovalStep: resolvedSteps[0].stepNumber,
            updatedAt: new Date(),
          })
          .where(eq(purchaseRequests.id, input.id));

        await tx.insert(auditLogs).values({
          eventType: "request.submitted",
          actorId: ctx.user.id,
          actorRole: ctx.user.role,
          entityType: "purchase_request",
          entityId: input.id,
          afterState: {
            status: "pending_approval",
            steps: resolvedSteps.length,
          } as Record<string, unknown>,
        });

        return {
          status: "pending_approval" as RequestStatus,
          steps: resolvedSteps.length,
        };
      });
    }),

  cancel: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const request = await db.query.purchaseRequests.findFirst({
        where: and(
          eq(purchaseRequests.id, input.id),
          eq(purchaseRequests.requesterId, ctx.user.id)
        ),
      });

      if (!request) throw new TRPCError({ code: "NOT_FOUND" });
      if (["approved", "cancelled", "rejected"].includes(request.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot cancel a request with status: ${request.status}`,
        });
      }

      await db.update(purchaseRequests)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(purchaseRequests.id, input.id));

      await insertAuditLog({
        eventType: "request.cancelled",
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        entityType: "purchase_request",
        entityId: input.id,
        beforeState: { status: request.status },
        afterState: { status: "cancelled", reason: input.reason },
      });

      return { success: true };
    }),

  addLineItem: protectedProcedure
    .input(
      z.object({
        requestId: z.string().uuid(),
        description: z.string().min(1),
        quantity: z.number().positive(),
        unitPrice: z.number().positive(),
        glAccountCode: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const request = await db.query.purchaseRequests.findFirst({
        where: and(
          eq(purchaseRequests.id, input.requestId),
          eq(purchaseRequests.requesterId, ctx.user.id),
          eq(purchaseRequests.status, "draft")
        ),
      });

      if (!request) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Draft request not found" });
      }

      const [item] = await db
        .insert(lineItems)
        .values({
          requestId: input.requestId,
          description: input.description,
          quantity: String(input.quantity),
          unitPrice: String(input.unitPrice),
          glAccountCode: input.glAccountCode,
        })
        .returning();

      return item;
    }),
});
