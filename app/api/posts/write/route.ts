import { respond } from "../../../../server/http.ts";
import { writePost } from "../../../../server/handlers.ts";
import { liveDeps } from "../../../../server/deps.ts";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => respond(() => writePost(req, liveDeps()));
