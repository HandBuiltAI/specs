import { respond } from "../../../server/http.ts";
import { intakeTurn } from "../../../server/intake.ts";
import { liveDeps } from "../../../server/deps.ts";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => respond(() => intakeTurn(req, liveDeps()));
