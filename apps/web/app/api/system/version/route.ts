import { fetchApiVersion } from "@/lib/version-bff";

export const dynamic = "force-dynamic";

export async function GET() {
  return fetchApiVersion();
}
