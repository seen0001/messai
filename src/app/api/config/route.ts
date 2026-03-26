import { NextResponse } from "next/server";
import { getRoleConfigForClient } from "@/lib/roles";

export async function GET() {
  const roles = getRoleConfigForClient();
  return NextResponse.json({ roles });
}
