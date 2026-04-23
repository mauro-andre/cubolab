import type { ResolvedDistro } from "./osDetect.js";

// Formata `ResolvedDistro` pra display humano. Separado em helper pra
// testar sem depender do command runner + garantir que o output do bootstrap
// e do teardown ficam consistentes.
//
// Direct match: `"fedora (fedora-family)"`.
// Via ID_LIKE:  `"rocky (fedora-family, matched via ID_LIKE=rhel)"` —
// transparência do dispatcher pra user entender como cobriu distro não
// listada no DIRECT_MAP (ver osDetect.ts).
export const formatResolvedDistro = (distro: ResolvedDistro): string => {
    if (distro.matchedVia === "direct") {
        return `${distro.id} (${distro.family})`;
    }
    return `${distro.id} (${distro.family}, matched via ID_LIKE=${distro.matchedAncestor})`;
};
