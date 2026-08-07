const TZ = "America/Sao_Paulo";

export function fmtDateTimeBR(
  d: Date | string | number,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  return new Date(d).toLocaleString("pt-BR", { timeZone: TZ, ...opts });
}

export function fmtDateBR(
  d: Date | string | number,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  return new Date(d).toLocaleDateString("pt-BR", { timeZone: TZ, ...opts });
}
