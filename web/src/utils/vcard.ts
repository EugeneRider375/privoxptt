// D56 — электронная визитка. vCard 3.0: широко совместимый формат, camera app
// на iOS и Android распознаёт его прямо из QR без сайта и без интернета —
// весь контакт лежит в самом коде, а не по ссылке на него.
export interface VCardFields {
  firstName: string;
  lastName: string;
  org?: string;
  title?: string;
  phone?: string;
  email?: string;
  urls?: string[];
}

/** \r\n обязателен по спецификации vCard — просто \n не все парсеры примут. */
export function buildVCard(fields: VCardFields): string {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${fields.lastName};${fields.firstName};;;`,
    `FN:${fields.firstName} ${fields.lastName}`,
  ];
  if (fields.org) lines.push(`ORG:${fields.org}`);
  if (fields.title) lines.push(`TITLE:${fields.title}`);
  if (fields.phone) lines.push(`TEL;TYPE=CELL:${fields.phone}`);
  if (fields.email) lines.push(`EMAIL:${fields.email}`);
  for (const url of fields.urls ?? []) lines.push(`URL:${url}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export function downloadVCard(vcard: string, filename: string): void {
  const blob = new Blob([vcard], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.vcf') ? filename : `${filename}.vcf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
