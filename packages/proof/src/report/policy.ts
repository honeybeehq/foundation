import type { Links } from "../capture/types.ts";
import { defaults, type Tolerances } from "../compare/types.ts";
import type { VerifyPolicy } from "./index.ts";
/** Use reviewed/base-revision links, never a candidate report's own manifest. */
export function policyFromLinks(
  links: Links,
  tolerances: Tolerances = defaults,
): VerifyPolicy {
  if (links.schema !== "fdn-links/0" || !links.artboards?.length)
    throw Error("Policy requires reviewed fdn-links/0");
  const required = links.artboards.flatMap((board) =>
    board.states.map((state) => ({
      artboard: board.id,
      state: state.name,
      viewport: board.viewport,
    })),
  );
  if (!required.length)
    throw Error("Policy needs at least one required capture");
  return {
    tolerances: { ...tolerances },
    required,
    designBinding: links.binding ?? "chain-head",
    requireHtmlSha256: true,
  };
}
