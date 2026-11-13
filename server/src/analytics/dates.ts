const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

const formatters = new Map<string, Intl.DateTimeFormat>();
const partsFormatter = (timeZone: string) => {
  const cached = formatters.get(timeZone); if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  formatters.set(timeZone, formatter);
  return formatter;
};

const parts = (date: Date, timeZone: string) => Object.fromEntries(
  partsFormatter(timeZone).formatToParts(date)
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)])
) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;

export function validTimeZone(value: string | undefined) {
  const timeZone = value?.trim() || 'UTC';
  if (timeZone.length > 100) return null;
  try { partsFormatter(timeZone).format(new Date(0)); return timeZone; }
  catch { return null; }
}

export function dayInTimeZone(iso: string, timeZone = 'UTC') {
  const value = parts(new Date(iso), timeZone);
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
}

export function nextDay(day: string) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function localMidnightUtc(day: string, timeZone: string) {
  if (!dayPattern.test(day)) throw new Error('Invalid local date.');
  const desired = Date.parse(`${day}T00:00:00.000Z`);
  let candidate = desired;
  // Re-evaluate because the UTC offset can differ across a daylight-saving boundary.
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const value = parts(new Date(candidate), timeZone);
    const representedAsUtc = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second);
    candidate = desired - (representedAsUtc - candidate);
  }
  return new Date(candidate).toISOString();
}

export function utcRangeForLocalDays(from: string, to: string, timeZone = 'UTC') {
  return { start: localMidnightUtc(from, timeZone), end: localMidnightUtc(nextDay(to), timeZone) };
}
