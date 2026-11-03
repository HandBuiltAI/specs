import { respond } from "../../../server/http.ts";
import { getKit } from "../../../server/extract.ts";
import { liveDeps } from "../../../server/deps.ts";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => respond(() => getKit(req, liveDeps()));
