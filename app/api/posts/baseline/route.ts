import { respond } from "../../../../server/http.ts";
import { baselinePost } from "../../../../server/make.ts";
import { liveDeps } from "../../../../server/deps.ts";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => respond(() => baselinePost(req, liveDeps()));
