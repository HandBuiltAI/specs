import { respond } from "../../../../../server/http.ts";
import { boldRender } from "../../../../../server/bold.ts";
import { liveDeps } from "../../../../../server/deps.ts";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => respond(() => boldRender(req, liveDeps()));
