// Mutex via promise-chain. Zero dependências. Serializa sequências
// `read → modify → write` do state.json — sem isso, mutations paralelas
// veriam o mesmo snapshot e alguma seria perdida no último write (race
// clássica do read-modify-write apesar do rename atômico do fs).
//
// Event loop single-threaded do JS garante que `stateLock = new Promise(...)`
// é atômico em relação aos outros handlers — cada call pega o lock anterior
// e instala seu próprio antes do primeiro `await`.

let stateLock: Promise<void> = Promise.resolve();

export const withStateLock = async <T>(fn: () => Promise<T>): Promise<T> => {
    const previous = stateLock;
    let release!: () => void;
    stateLock = new Promise<void>((resolve) => {
        release = resolve;
    });
    try {
        await previous;
        return await fn();
    } finally {
        release();
    }
};
