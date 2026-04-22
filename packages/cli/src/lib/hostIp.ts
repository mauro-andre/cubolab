import { execa } from "execa";

const IP_RE = /inet (\d+\.\d+\.\d+\.\d+)/;

// Detecta o IP do host libvirt (virbr0, default da rede virtual padrão).
// Override via CUBOLAB_HOST_IP pra ambientes sem libvirt.
export const detectHostIp = async (): Promise<string> => {
    const override = process.env.CUBOLAB_HOST_IP;
    if (override && override.length > 0) return override;

    const result = await execa("ip", ["-4", "addr", "show", "virbr0"], {
        reject: false,
        timeout: 3000,
    });
    if (result.exitCode === 0) {
        const match = IP_RE.exec(String(result.stdout));
        if (match?.[1]) return match[1];
    }
    // TODO(M4): em máquinas sem libvirt/virbr0, o workflow típico (worker
    // bootstrap via SSH) requer CUBOLAB_HOST_IP setado manualmente pra apontar
    // pro endereço acessível do worker. M4 documenta o trade-off e, se fizer
    // sentido, expande a detecção (Hetzner, Docker host, etc).
    return "127.0.0.1";
};
