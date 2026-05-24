import "server-only";
import { createContext } from "./context";
import { appRouter } from "@/server/root";
import { createCallerFactory } from "./init";
import { cache } from "react";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";

const createCaller = createCallerFactory(appRouter);

export const createServerCaller = cache(async () => {
  const hdrs = await headers();
  const req = {
    headers: hdrs,
    cookies: { getAll: () => [] },
  } as unknown as NextRequest;

  const ctx = await createContext({ req });
  return createCaller(ctx);
});
