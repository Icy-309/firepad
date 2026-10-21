import { NextResponse } from "next/server";
import { AuthError, requireAdmin } from "./auth";

/** Wrap an admin API handler: 401 unless a valid admin session cookie is present. */
export function adminRoute<A extends unknown[]>(handler: (admin: string, ...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    let admin: string;
    try {
      admin = requireAdmin();
    } catch (e) {
      if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: 401 });
      throw e;
    }
    return handler(admin, ...args);
  };
}
