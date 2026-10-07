import type { IncomingMessage, ServerResponse } from "node:http";
import { handleVercelRequest } from "../src/vercel";

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  await handleVercelRequest(request, response);
}
