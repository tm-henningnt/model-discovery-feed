import { feedJsonSchema } from "@/feed/json-schema";
import { jsonResponse } from "@/server/http";

export async function GET() {
  return jsonResponse(feedJsonSchema, {
    headers: {
      "Cache-Control": "public, max-age=3600"
    }
  });
}
