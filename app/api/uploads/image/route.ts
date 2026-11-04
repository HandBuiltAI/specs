import { respond } from "../../../../server/http.ts";
import { uploadImage } from "../../../../server/intake.ts";
import { liveDeps } from "../../../../server/deps.ts";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => respond(() => uploadImage(req, liveDeps()));
