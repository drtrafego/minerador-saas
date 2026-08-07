export type MetaTemplate = {
  name: string;
  status: string;
  language: string;
  category: string;
  body: string;
};

export type ListarTemplatesResult = {
  ok: boolean;
  templates: MetaTemplate[];
  error?: string;
};

type GraphComponent = {
  type?: string;
  text?: string;
};

type GraphTemplate = {
  name?: string;
  status?: string;
  language?: string;
  category?: string;
  components?: GraphComponent[];
};

function extrairBody(components: GraphComponent[] | undefined): string {
  if (!components) return "";
  const body = components.find((c) => (c.type ?? "").toUpperCase() === "BODY");
  return body?.text ?? "";
}

export async function listarTemplatesMeta(opts: {
  accessToken: string;
  wabaId: string;
  graphVersion?: string;
}): Promise<ListarTemplatesResult> {
  const { accessToken, wabaId, graphVersion = "v25.0" } = opts;

  const url =
    `https://graph.facebook.com/${graphVersion}/${wabaId}/message_templates` +
    `?fields=name,status,language,category,components&limit=100`;

  try {
    // Token vai no header Authorization, nunca na URL (evita vazar em logs/proxies).
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await res.json().catch(() => ({}))) as {
      data?: GraphTemplate[];
      error?: { message?: string };
    };

    if (!res.ok) {
      const msg =
        data?.error?.message ?? `Graph API retornou ${res.status}`;
      return { ok: false, templates: [], error: msg };
    }

    const templates: MetaTemplate[] = (data.data ?? []).map((t) => ({
      name: t.name ?? "",
      status: (t.status ?? "").toUpperCase(),
      language: t.language ?? "",
      category: t.category ?? "",
      body: extrairBody(t.components),
    }));

    return { ok: true, templates };
  } catch (err) {
    return {
      ok: false,
      templates: [],
      error: `Falha de rede ao consultar a Meta: ${String(err)}`,
    };
  }
}
