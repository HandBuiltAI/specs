import { respond } from "../../../../server/http.ts";
import { editItem } from "../../../../server/extract.ts";
import { liveDeps } from "../../../../server/deps.ts";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => respond(() => editItem(req, liveDeps()));
