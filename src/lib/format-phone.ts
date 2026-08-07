export type FormattedPhone = {
  display: string;
  digits: string;
  href: string;
};

function normalizeBRDigits(raw: string): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("00")) digits = digits.slice(2);

  if (digits.length === 10 || digits.length === 11) {
    digits = "55" + digits;
  }

  if (digits.length < 10 || digits.length > 15) return null;

  return digits;
}

export function formatPhoneBR(raw: string | null | undefined): FormattedPhone | null {
  if (!raw) return null;

  const digits = normalizeBRDigits(raw);
  if (!digits) return null;

  const href = `https://wa.me/${digits}`;

  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4);
    const local = digits.slice(4);
    const meio = local.length === 9 ? local.slice(0, 5) : local.slice(0, 4);
    const fim = local.length === 9 ? local.slice(5) : local.slice(4);
    return {
      display: `+55 (${ddd}) ${meio}-${fim}`,
      digits,
      href,
    };
  }

  return {
    display: `+${digits}`,
    digits,
    href,
  };
}
