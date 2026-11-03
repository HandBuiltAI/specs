import { respond } from "../../../server/http.ts";
import { createPost } from "../../../server/handlers.ts";
import { liveDeps } from "../../../server/deps.ts";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => respond(() => createPost(req, liveDeps()));
