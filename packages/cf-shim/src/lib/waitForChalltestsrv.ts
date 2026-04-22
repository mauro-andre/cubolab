import { CHALLTESTSRV_URL } from "../constants.js";

// Aguarda o challtestsrv ficar reachable. `depends_on` no compose garante
// start order, mas NÃO readiness do processo interno — o container pode
// estar "Up" sem o Go binary ter terminado de bindar a porta. Sem esse
// retry, a hidratação no startup (POST /add-a pra cada record do state.json)
// estoura com ECONNREFUSED e o cf-shim crasha antes de servir.
//
// Estratégia: GET / (qualquer resposta HTTP conta — challtestsrv não tem
// route pra "/" e vai retornar 404, mas isso prova que o binary está
// respondendo). Backoff exponencial 100ms → 5s, timeout total 30s default.
export const waitForChalltestsrv = async (timeoutMs = 30_000): Promise<void> => {
    const start = Date.now();
    let delay = 100;
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(CHALLTESTSRV_URL, { signal: AbortSignal.timeout(1000) });
            await res.arrayBuffer().catch(() => undefined);
            return;
        } catch {
            // ECONNREFUSED / timeout / DNS-not-ready → retry
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 5000);
    }
    throw new Error(
        `challtestsrv didn't become reachable at ${CHALLTESTSRV_URL} within ${timeoutMs}ms`,
    );
};
