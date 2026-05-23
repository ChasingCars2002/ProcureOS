import { type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { db, users } from "@flowprocure/db";
import { eq } from "drizzle-orm";
import type { User } from "@flowprocure/db";

export type Context = {
  user: User | null;
  req: NextRequest;
};

export async function createContext({
  req,
}: {
  req: NextRequest;
}): Promise<Context> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll() {
          // Read-only in this context
        },
      },
    }
  );

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return { user: null, req };
  }

  const dbUser = await db.query.users.findFirst({
    where: eq(users.id, authUser.id),
  });

  return { user: dbUser ?? null, req };
}
