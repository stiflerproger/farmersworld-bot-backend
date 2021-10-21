/** Возвращает дату по заданному шаблону yyyy-год, mm-месяц, dd-день */
export function formatDate(date: Date, template = 'yyyy-mm-dd') {
  if (!(date instanceof Date)) {
    throw new Error('Invalid date param');
  }

  if (typeof template !== 'string') {
    throw new Error('Invalid template param');
  }

  return template
    .replace('yyyy', String(date.getFullYear()))
    .replace('mm', String(date.getMonth() + 1).padStart(2, '0'))
    .replace('dd', String(date.getDate()).padStart(2, '0'));
}
