import pc from "picocolors";
import type { Component, StackState, StatusReport } from "../schemas/status.js";

export const renderJson = (report: StatusReport): string => `${JSON.stringify(report, null, 2)}\n`;

const stackLabel = (stack: StackState): string => {
    if (stack === "up") return pc.green("up");
    if (stack === "partial") return pc.yellow("partial");
    return pc.red("down");
};

const componentBadge = (c: Component): string => {
    if (!c.running) return pc.dim("○ stopped");
    if (!c.healthy) return pc.yellow("● unhealthy");
    return pc.green("● healthy");
};

export const renderHuman = (report: StatusReport): string => {
    const out: string[] = [];
    out.push(`${pc.bold("cubolab sandbox:")} ${stackLabel(report.stack)}`);
    out.push("");

    for (const [name, comp] of Object.entries(report.components)) {
        out.push(`  ${pc.bold(name)}  ${componentBadge(comp)}`);
        for (const [key, url] of Object.entries(comp.endpoints)) {
            out.push(`    ${pc.dim(key.padEnd(5))} ${url}`);
        }
        if (comp.lastError) {
            out.push(`    ${pc.red("error:")} ${comp.lastError}`);
        }
        out.push("");
    }

    const bundleMark = report.trustBundle.exists ? pc.green("✓") : pc.dim("absent");
    out.push(`${pc.dim("Trust bundle:")}  ${bundleMark}  ${report.trustBundle.path}`);
    out.push(`${pc.dim("Compose tool:")}  ${report.composeTool}`);
    out.push(`${pc.dim("Host IP:")}       ${report.hostIp}`);

    if (report.splitDns) {
        const joined = report.splitDns.domains.join(", ");
        out.push(
            `${pc.dim("Split DNS:")}    ${pc.green("✓")} ${joined} → ${report.splitDns.hostIp}:8053  (${pc.dim(report.splitDns.method)})`,
        );
    }

    return `${out.join("\n")}\n`;
};
