import { respond } from "../../../../../server/http.ts";
import { boldJudge } from "../../../../../server/bold.ts";
import { liveDeps } from "../../../../../server/deps.ts";
import { liveStarter } from "../../../../../server/bold-start.ts";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => respond(() => boldJudge(req, liveDeps(), liveStarter(req)));
