import { z } from "zod";
import { eq, and, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "@/lib/trpc/init";
import {
  db,
  purchaseRequests,
  approvalSteps,
  approvalAssignments,
  auditLogs,
  erpSyncJobs,
  departments,
} from "@flowprocure/db";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@flowprocure/db";

type Db = PostgresJsDatabase<typeof schema>;

async function advanceApprovalStep(
  tx: Db,
  stepId: string,
  decision: "approved" | "rejected",
  actorId: string,
  actorRole: string
): Promise<void> {
  const step = await tx.query.approvalSteps.findFirst({
    where: eq(approvalSteps.id, stepId),
    with: { assignments: true, request: true },
  });

  if (!step) return;

  const requestId = step.requestId;
  const request = step.request as { id: string; currentApprovalStep: number } | null;
  if (!request) return;

  if (decision === "rejected") {
    await tx.update(approvalSteps)
      .set({ status: "rejected", completedAt: new Date() })
      .where(eq(approvalSteps.id, stepId));

    await tx.update(purchaseRequests)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(eq(purchaseRequests.id, requestId));

    await tx.insert(auditLogs).values({
      eventType: "request.rejected",
      actorId,
      actorRole,
      entityType: "purchase_request",
      entityId: requestId,
      afterState: { status: "rejected", rejectedAtStep: step.stepNumber } as Record<string, unknown>,
    });
    return;
  }

  // Check if step is complete based on requires_all flag
  const assignments = step.assignments as Array<{ decision: string }>;
  const anyApproved = assignments.some((a) => a.decision === "approved");
  const allApproved = assignments.every((a) => a.decision === "approved");
  const stepComplete = step.requiresAll ? allApproved : anyApproved;

  if (!stepComplete) return;

  await tx.update(approvalSteps)
    .set({ status: "approved", completedAt: new Date() })
    .where(eq(approvalSteps.id, stepId));

  // Find the next pending step in sequence
  const nextStep = await tx.query.approvalSteps.findFirst({
    where: and(
      eq(approvalSteps.requestId, requestId),
      eq(approvalSteps.status, "pending")
    ),
    orderBy: approvalSteps.stepNumber,
  });

  if (nextStep) {
    await tx.update(purchaseRequests)
      .set({ currentApprovalStep: nextStep.stepNumber, updatedAt: new Date() })
      .where(eq(purchaseRequests.id, requestId));
  } else {
    // All steps complete — fully approved
    await tx.update(purchaseRequests)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(purchaseRequests.id, requestId));

    const erpSystem = (process.env.ERP_SYSTEM ?? "quickbooks") as "quickbooks" | "netsuite";
    await tx.insert(erpSyncJobs).values({
      requestId,
      erpSystem,
      operation: "export_po",
      status: "queued",
      payload: { requestId } as Record<string, unknown>,
    });

    await tx.insert(auditLogs).values({
      eventType: "request.approved",
      actorId,
      actorRole,
      entityType: "purchase_request",
      entityId: requestId,
      afterState: { status: "approved" } as Record<string, unknown>,
    });
  }
}

export const approvalsRouter = router({
  inbox: protectedProcedure.query(async ({ ctx }) => {
    // Optimized single query for the Inbox screen
    const rows = await db
      .select({
        assignmentId: approvalAssignments.id,
        requestId: purchaseRequests.id,
        requestNumber: purchaseRequests.requestNumber,
        title: purchaseRequests.title,
        totalAmount: purchaseRequests.totalAmount,
        status: purchaseRequests.status,
        createdAt: purchaseRequests.createdAt,
        neededByDate: purchaseRequests.neededByDate,
        stepId: approvalSteps.id,
        stepLabel: approvalSteps.label,
        stepNumber: approvalSteps.stepNumber,
      })
      .from(approvalAssignments)
      .innerJoin(approvalSteps, eq(approvalSteps.id, approvalAssignments.stepId))
      .innerJoin(
        purchaseRequests,
        and(
          eq(purchaseRequests.id, approvalSteps.requestId),
          eq(purchaseRequests.currentApprovalStep, approvalSteps.stepNumber)
        )
      )
      .where(
        and(
          eq(approvalAssignments.assigneeId, ctx.user.id),
          eq(approvalAssignments.decision, "pending")
        )
      )
      .orderBy(purchaseRequests.createdAt);

    return rows;
  }),

  decide: protectedProcedure
    .input(
      z.object({
        assignmentId: z.string().uuid(),
        decision: z.enum(["approved", "rejected"]),
        comment: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const assignment = await db.query.approvalAssignments.findFirst({
        where: and(
          eq(approvalAssignments.id, input.assignmentId),
          eq(approvalAssignments.assigneeId, ctx.user.id),
          eq(approvalAssignments.decision, "pending")
        ),
      });

      if (!assignment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pending assignment not found",
        });
      }

      await db.transaction(async (tx) => {
        await tx.update(approvalAssignments)
          .set({
            decision: input.decision,
            comment: input.comment,
            decidedAt: new Date(),
          })
          .where(eq(approvalAssignments.id, input.assignmentId));

        await tx.insert(auditLogs).values({
          eventType: `approval.${input.decision}`,
          actorId: ctx.user.id,
          actorRole: ctx.user.role,
          entityType: "approval_assignment",
          entityId: input.assignmentId,
          afterState: {
            decision: input.decision,
            comment: input.comment,
            stepId: assignment.stepId,
          } as Record<string, unknown>,
        });

        await advanceApprovalStep(
          tx as unknown as Db,
          assignment.stepId,
          input.decision,
          ctx.user.id,
          ctx.user.role
        );
      });

      return { success: true };
    }),

  bulkDecide: protectedProcedure
    .input(
      z.object({
        assignmentIds: z.array(z.string().uuid()).min(1).max(100),
        decision: z.enum(["approved", "rejected"]),
        comment: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const assignments = await db.query.approvalAssignments.findMany({
        where: and(
          inArray(approvalAssignments.id, input.assignmentIds),
          eq(approvalAssignments.assigneeId, ctx.user.id),
          eq(approvalAssignments.decision, "pending")
        ),
      });

      if (assignments.length !== input.assignmentIds.length) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "One or more assignments are invalid or not pending",
        });
      }

      let processedCount = 0;

      await db.transaction(async (tx) => {
        for (const assignment of assignments) {
          await tx.update(approvalAssignments)
            .set({
              decision: input.decision,
              comment: input.comment,
              decidedAt: new Date(),
            })
            .where(eq(approvalAssignments.id, assignment.id));

          await tx.insert(auditLogs).values({
            eventType: `approval.bulk_${input.decision}`,
            actorId: ctx.user.id,
            actorRole: ctx.user.role,
            entityType: "approval_assignment",
            entityId: assignment.id,
            afterState: {
              decision: input.decision,
              bulk: true,
              totalInBatch: input.assignmentIds.length,
            } as Record<string, unknown>,
          });

          await advanceApprovalStep(
            tx as unknown as Db,
            assignment.stepId,
            input.decision,
            ctx.user.id,
            ctx.user.role
          );

          processedCount++;
        }
      });

      return { processedCount };
    }),

  getTimeline: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(async ({ input }) => {
      return db.query.approvalSteps.findMany({
        where: eq(approvalSteps.requestId, input.requestId),
        with: {
          assignments: {
            with: { assignee: true },
          },
          policy: true,
        },
        orderBy: approvalSteps.stepNumber,
      });
    }),
});
