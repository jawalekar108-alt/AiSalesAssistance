// IST helpers (India has no DST, so a fixed +05:30 offset is safe)
const TZ = 'Asia/Kolkata';

const toDate  = (day, hhmm) => new Date(`${day}T${String(hhmm).slice(0, 5)}:00+05:30`);
const dayStr  = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
const weekday = (day) => new Date(`${day}T12:00:00+05:30`).getUTCDay();
const addDays = (day, n) => {
  const d = new Date(`${day}T12:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + n);
  return dayStr(d);
};
const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
const fmtTime = (d) =>
  new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }).toUpperCase();
const hhmm = (d) =>
  new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });

module.exports = { TZ, toDate, dayStr, weekday, addDays, fmtDate, fmtTime, hhmm };
