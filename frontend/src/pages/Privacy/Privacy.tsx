import { LegalShell } from "../Legal/LegalShell.tsx";
import { getLegalDocument } from "../Legal/content.ts";

/**
 * Thin route wrapper — the markup lives in `LegalShell` and the copy in
 * `Legal/content.ts` so all four legal pages stay in sync.
 */
function Privacy() {
  return <LegalShell document={getLegalDocument("privacy")} />;
}

export default Privacy;
