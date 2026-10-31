// Datas do motor: sempre texto AAAA-MM-DD, sem fuso horário.
export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** true só para uma data real do calendário (rejeita 2026-02-31). */
export function diaValido(s) {
  if (typeof s !== 'string' || !DATA.test(s)) return false;
  const [a, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Dia de hoje no fuso da máquina, não em UTC. */
export function diaLocal(agora = new Date()) {
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
}

export function somarDias(dia, n) {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Dias inteiros de a até b (positivo quando b é depois de a). */
export function diasEntre(a, b) {
  const t = dia => { const [y, m, d] = dia.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}

/** "9 de outubro de 2026". Devolve o texto original se não for uma data. */
export function dataLonga(dia) {
  if (!DATA.test(String(dia))) return String(dia ?? '');
  const [a, m, d] = dia.split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

/** "outubro de 2026" a partir de AAAA-MM. */
export function mesLongo(mes) {
  const [a, m] = mes.split('-').map(Number);
  return `${MESES[m - 1]} de ${a}`;
}
