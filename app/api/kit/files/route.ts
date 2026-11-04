import { respond } from "../../../../server/http.ts";
import { kitFiles } from "../../../../server/make.ts";
import { liveDeps } from "../../../../server/deps.ts";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => respond(() => kitFiles(req, liveDeps()));
