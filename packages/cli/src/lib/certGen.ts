// `reflect-metadata` é peer de tsyringe (que @peculiar/x509 usa internamente)
// e precisa ser importada antes da primeira referência à lib. Side-effect only.
import "reflect-metadata";
import { webcrypto } from "node:crypto";
import {
    BasicConstraintsExtension,
    ExtendedKeyUsageExtension,
    KeyUsageFlags,
    KeyUsagesExtension,
    PemConverter,
    SubjectAlternativeNameExtension,
    X509CertificateGenerator,
} from "@peculiar/x509";

const ALG: RsaHashedKeyGenParams = {
    name: "RSASSA-PKCS1-v1_5",
    hash: "SHA-256",
    publicExponent: new Uint8Array([1, 0, 1]),
    modulusLength: 2048,
};

// serverAuth — cert vai ser apresentado pelo Pebble em TLS handshake.
const EKU_SERVER_AUTH = "1.3.6.1.5.5.7.3.1";

// DNS adicional pra quando houver acesso por nome ao container (ex: do próprio
// challtestsrv via `cubolab-pebble.local`). Em M1 ninguém resolve esse nome,
// mas incluir cedo evita regenerar cert depois.
const DEFAULT_DNS_NAMES = ["localhost", "cubolab-pebble.local"] as const;

export type GeneratePebbleCertParams = {
    hostIp: string;
    extraIps?: readonly string[];
    extraDns?: readonly string[];
    years?: number;
};

export type GeneratePebbleCertResult = {
    certPem: string;
    keyPem: string;
};

export const generatePebbleServerCert = async ({
    hostIp,
    extraIps = [],
    extraDns = [],
    years = 10,
}: GeneratePebbleCertParams): Promise<GeneratePebbleCertResult> => {
    const crypto = webcrypto as unknown as Crypto;
    const keys = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);

    const notBefore = new Date();
    const notAfter = new Date(notBefore.getTime() + years * 365 * 24 * 60 * 60 * 1000);

    // 127.0.0.1 sempre presente pra curl local funcionar mesmo quando hostIp
    // é o IP do libvirt (o cliente curl no host bate em 127.0.0.1:14000).
    const ips = Array.from(new Set([hostIp, "127.0.0.1", ...extraIps]));
    const dns = Array.from(new Set([...DEFAULT_DNS_NAMES, ...extraDns]));

    const cert = await X509CertificateGenerator.createSelfSigned(
        {
            name: "CN=cubolab-pebble, O=cubolab",
            notBefore,
            notAfter,
            signingAlgorithm: ALG,
            keys,
            extensions: [
                new BasicConstraintsExtension(false, undefined, true),
                new KeyUsagesExtension(
                    KeyUsageFlags.digitalSignature | KeyUsageFlags.keyEncipherment,
                    true,
                ),
                new ExtendedKeyUsageExtension([EKU_SERVER_AUTH], false),
                new SubjectAlternativeNameExtension(
                    [
                        ...dns.map((value) => ({ type: "dns" as const, value })),
                        ...ips.map((value) => ({ type: "ip" as const, value })),
                    ],
                    false,
                ),
            ],
        },
        crypto,
    );

    const certPem = cert.toString("pem");
    const privRaw = await crypto.subtle.exportKey("pkcs8", keys.privateKey);
    const keyPem = PemConverter.encode(privRaw, "PRIVATE KEY");

    return { certPem, keyPem };
};
