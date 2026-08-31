const BRACKET_ALIASES: Record<string, string> = {
  name: "first_name",
  "property/address": "address",
  "agent name": "agent_name",
  agentname: "agent_name",
};

function stringifyVars(
  vars: Record<string, string | number | null | undefined> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars || {})) {
    if (value == null) continue;
    out[key] = String(value);
  }
  if (out.first_name && !out.name) out.name = out.first_name;
  if (out.name && !out.first_name) {
    out.first_name = out.name.trim().split(/\s+/)[0] || out.name;
  }
  if (out.address && !out.property) out.property = out.address;
  if (out.property && !out.address) out.address = out.property;
  if (out.agentName && !out.agent_name) out.agent_name = out.agentName;
  if (out.agent_name && !out.agentName) out.agentName = out.agent_name;
  return out;
}

export function substitutePartnershipTemplate(
  template: string | null | undefined,
  vars: Record<string, string | number | null | undefined> | undefined,
): string {
  if (!template) return "";
  const map = stringifyVars(vars);
  const curly = template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, raw: string) => {
    const key = raw.trim();
    return map[key] ?? "";
  });
  return curly.replace(/\[([^\]]+)\]/g, (full, raw: string) => {
    const label = String(raw).trim();
    const alias = BRACKET_ALIASES[label.toLowerCase()] || label.replace(/\s+/g, "_");
    if (map[alias] != null) return map[alias];
    if (map[label] != null) return map[label];
    if (!/^[A-Za-z][A-Za-z0-9_ /.-]*$/.test(label)) return full;
    if (label.includes(" ")) {
      const compact = label.replace(/[\s/]+/g, "_").toLowerCase();
      if (map[compact] != null) return map[compact];
    }
    return map[alias] ?? "";
  });
}
