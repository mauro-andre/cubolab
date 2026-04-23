import { execa } from "execa";

const detectHostIp = (): string => process.env.CUBOLAB_HOST_IP ?? "127.0.0.1";

// Consulta o challtestsrv DNS mock pelo IP resolvido pro hostname.
// Retorna array de IPs (múltiplos = round-robin). Array vazio se record
// inexistente.
export const dnsLookup = async (hostname: string): Promise<string[]> => {
    const hostIp = detectHostIp();
    const r = await execa(
        "dig",
        [`@${hostIp}`, "-p", "8053", hostname, "+short", "+time=2", "+tries=1"],
        { reject: false, timeout: 5000 },
    );
    return r.stdout
        .trim()
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
};
