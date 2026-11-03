import { respond } from "../../../server/http.ts";
import { getStatus } from "../../../server/handlers.ts";
import { liveDeps } from "../../../server/deps.ts";

export const dynamic = "force-dynamic";

export const GET = () => respond(() => getStatus(liveDeps()));
