export type IssuedCert = {
    cn: string;
    sans: string[];
    notAfter: string;
};

// TODO(M5+): Pebble não expõe endpoint público de enumeração de certs
// emitidos pela CA interna — não há API stable upstream. Implementado
// como stub pra manter contrato estável no Sandbox API e não quebrar
// consumer depois.
//
// Workaround enquanto isso (ver README.md): validar cert emitido via
// `openssl s_client` ou `curl --cacert trustBundlePath`.
export const listIssuedCerts = async (): Promise<IssuedCert[]> => [];
