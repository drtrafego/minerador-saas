// Modelos de ICP (perfil de cliente ideal) prontos por nicho, para o Passo 3 do
// wizard de mineracao. Ao escolher um, o texto abaixo preenche o campo de
// qualificacao (qualificationPrompt) e o usuario pode ajustar. Cada prompt orienta
// o Claude a usar os sinais reais disponiveis por fonte:
//   Google Maps: categoria, avaliacao (rating), total de avaliacoes, site, telefone
//   LinkedIn: cargo (headline), empresa, cidade
//   Instagram: bio, seguidores, site na bio

export type IcpTemplate = {
  key: string;
  label: string;
  niche: string;
  prompt: string;
};

function build(opts: {
  quem: string;
  aprovar: string[];
  rejeitar: string[];
  notaAlta: string;
}): string {
  return [
    `Voce avalia se o lead se encaixa como ${opts.quem}, com potencial para contratar trafego pago (anuncios no Google e no Meta Ads) para atrair mais clientes.`,
    "",
    "Aprove (approved) quando houver sinais de:",
    ...opts.aprovar.map((s) => `- ${s}`),
    "",
    "Rejeite (rejected) quando:",
    ...opts.rejeitar.map((s) => `- ${s}`),
    "",
    `Se faltar dado para avaliar, nao invente: prefira uma nota mais baixa a supor. ${opts.notaAlta}`,
  ].join("\n");
}

export const ICP_TEMPLATES: IcpTemplate[] = [
  {
    key: "medico",
    label: "Médico / Clínica",
    niche: "médico",
    prompt: build({
      quem: "medico, clinica medica ou consultorio",
      aprovar: [
        "e medico, clinica, consultorio ou profissional da area medica",
        "atende ou pode atender paciente particular (nao so convenio)",
        "tem presenca profissional: site proprio, perfil ativo ou boas avaliacoes",
        "especialidade com ticket relevante (cirurgia, estetica, exames, etc)",
      ],
      rejeitar: [
        "nao e da area medica ou de saude",
        "perfil claramente pessoal, sem atividade profissional",
        "sem qualquer indicio de estrutura (sem site, sem avaliacoes, muito pequeno)",
      ],
      notaAlta:
        "De nota maior a especialidades de ticket alto e clinicas com boa reputacao.",
    }),
  },
  {
    key: "dentista",
    label: "Dentista / Odontologia",
    niche: "dentista",
    prompt: build({
      quem: "dentista, clinica ou consultorio odontologico",
      aprovar: [
        "e dentista, clinica ou consultorio odontologico",
        "oferece tratamentos de ticket alto (implante, ortodontia, lentes, estetica)",
        "tem site, perfil ativo ou boas avaliacoes",
      ],
      rejeitar: [
        "nao e da area odontologica",
        "perfil pessoal sem atividade profissional",
        "sem estrutura visivel (sem site, sem avaliacoes)",
      ],
      notaAlta:
        "De nota maior a clinicas com foco em estetica/implante e boa reputacao.",
    }),
  },
  {
    key: "advogado",
    label: "Advogado / Escritório",
    niche: "advogado",
    prompt: build({
      quem: "advogado ou escritorio de advocacia",
      aprovar: [
        "e advogado ou escritorio de advocacia",
        "atua em areas com demanda de captacao (trabalhista, previdenciario, familia, tributario, criminal)",
        "tem presenca profissional (site, perfil ativo, OAB, boas avaliacoes)",
      ],
      rejeitar: [
        "nao e da area juridica",
        "perfil pessoal sem atuacao profissional",
        "orgao publico, sindicato ou defensoria (nao contrata trafego)",
      ],
      notaAlta:
        "De nota maior a escritorios que dependem de captacao ativa de clientes.",
    }),
  },
  {
    key: "restaurante",
    label: "Restaurante / Food",
    niche: "restaurante",
    prompt: build({
      quem: "restaurante, bar, hamburgueria, cafeteria ou negocio de alimentacao",
      aprovar: [
        "e restaurante, bar, lanchonete, cafeteria ou similar",
        "tem estrutura fisica (endereco, telefone) e recebe clientes no local",
        "tem site, redes ou boas avaliacoes no Google",
      ],
      rejeitar: [
        "nao e do ramo de alimentacao",
        "cozinha fantasma sem marca propria ou negocio inativo",
        "sem qualquer contato ou avaliacao (indicio de fechado)",
      ],
      notaAlta:
        "De nota maior a casas com boa avaliacao e volume de avaliacoes (movimento real).",
    }),
  },
  {
    key: "estetica",
    label: "Clínica de estética",
    niche: "clínica de estética",
    prompt: build({
      quem: "clinica de estetica, harmonizacao facial ou centro de beleza avancada",
      aprovar: [
        "e clinica de estetica, harmonizacao, dermato-estetica ou centro de beleza",
        "oferece procedimentos de ticket medio/alto",
        "tem presenca visual forte (Instagram ativo, site, boas avaliacoes)",
      ],
      rejeitar: [
        "nao e do ramo de estetica/beleza",
        "perfil pessoal de profissional sem clinica ou estrutura",
        "sem presenca digital nem avaliacoes",
      ],
      notaAlta:
        "De nota maior a clinicas com Instagram ativo e procedimentos de alto valor.",
    }),
  },
  {
    key: "solar",
    label: "Energia solar",
    niche: "energia solar",
    prompt: build({
      quem: "empresa de energia solar (fotovoltaica), integrador ou instalador",
      aprovar: [
        "e empresa de energia solar, integrador ou instalador fotovoltaico",
        "atende cliente final (residencial/comercial), nao so revenda",
        "tem site, perfil ativo ou boas avaliacoes",
      ],
      rejeitar: [
        "nao atua com energia solar",
        "apenas fabricante/distribuidor sem venda ao cliente final",
        "perfil pessoal sem empresa",
      ],
      notaAlta:
        "De nota maior a empresas com estrutura e reputacao (ticket alto por projeto).",
    }),
  },
];
