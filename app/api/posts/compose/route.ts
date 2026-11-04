import { respond } from "../../../../server/http.ts";
import { composePost } from "../../../../server/compose.ts";
import { liveDeps } from "../../../../server/deps.ts";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => respond(() => composePost(req, liveDeps()));
