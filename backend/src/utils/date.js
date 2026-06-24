const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const ARG_TZ = 'America/Argentina/Buenos_Aires';

exports.combineLocal = (dateStr, timeStr) => {
  // Construir fecha y hora en la zona horaria de Argentina
  const dateTime = `${dateStr}T${timeStr}`;
  return dayjs.tz(dateTime, ARG_TZ).toDate();
};

exports.getDateRange = (type) => {
  const now = dayjs().tz(ARG_TZ);
  switch (type) {
    case 'today': {
      const desde = now.startOf('day');
      const hasta = desde.endOf('day');
      return { desde: desde.toDate(), hasta: hasta.toDate() };
    }
    case 'yesterday': {
      const base = now.subtract(1, 'day');
      const desde = base.startOf('day');
      const hasta = base.endOf('day');
      return { desde: desde.toDate(), hasta: hasta.toDate() };
    }
    case 'thisWeek': {
      const day = now.day() || 7;
      const desde = now.subtract(day - 1, 'day').startOf('day');
      const hasta = desde.add(6, 'day').endOf('day');
      return { desde: desde.toDate(), hasta: hasta.toDate() };
    }
    case 'lastWeek': {
      const day = now.day() || 7;
      const thisMonday = now.subtract(day - 1, 'day').startOf('day');
      const desde = thisMonday.subtract(7, 'day');
      const hasta = desde.add(6, 'day').endOf('day');
      return { desde: desde.toDate(), hasta: hasta.toDate() };
    }
    case 'thisMonth': {
      const desde = now.startOf('month');
      const hasta = now.endOf('month');
      return { desde: desde.toDate(), hasta: hasta.toDate() };
    }
    case 'lastMonth': {
      const base = now.subtract(1, 'month');
      const desde = base.startOf('month');
      const hasta = base.endOf('month');
      return { desde: desde.toDate(), hasta: hasta.toDate() };
    }
    case 'thisYear': {
      const desde = now.startOf('year');
      const hasta = now.endOf('year');
      return { desde: desde.toDate(), hasta: hasta.toDate() };
    }
    case 'lastYear': {
      const base = now.subtract(1, 'year');
      const desde = base.startOf('year');
      const hasta = base.endOf('year');
      return { desde: desde.toDate(), hasta: hasta.toDate() };
    }
    default:
      return {}; 
  }
};