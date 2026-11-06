import { respond } from "../../../../../server/http.ts";
import { boldStatus } from "../../../../../server/bold.ts";
import { liveDeps } from "../../../../../server/deps.ts";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => respond(() => boldStatus(req, liveDeps()));
