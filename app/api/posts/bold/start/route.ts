import { respond } from "../../../../../server/http.ts";
import { startBold } from "../../../../../server/bold.ts";
import { liveDeps } from "../../../../../server/deps.ts";
import { liveStarter } from "../../../../../server/bold-start.ts";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => respond(() => startBold(req, liveDeps(), liveStarter(req)));
