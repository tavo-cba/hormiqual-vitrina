import React, { useState, useEffect } from 'react';
import { Dropdown } from 'primereact/dropdown';
import { Calendar } from 'primereact/calendar';
import PropTypes from 'prop-types';

const OPTIONS = [
  { label: 'Hoy', value: 'today' },
  { label: 'Ayer', value: 'yesterday' },
  { label: 'Esta semana', value: 'thisWeek' },
  { label: 'Semana pasada', value: 'lastWeek' },
  { label: 'Este mes', value: 'thisMonth' },
  { label: 'Mes pasado', value: 'lastMonth' },
  { label: 'Este año', value: 'thisYear' },
  { label: 'Año pasado', value: 'lastYear' },
  { label: 'Personalizado', value: 'custom' }
];

const DateRangeDropdown = ({ value, onChange, placeholder = 'Seleccionar rango' }) => {
  const [option, setOption] = useState(value?.type || 'thisMonth');
  const [range, setRange] = useState(
    value?.type === 'custom' && value.from && value.to ? [value.from, value.to] : null
  );

useEffect(() => {
  if (option !== 'custom') {
    onChange({ type: option });
    return;
  }

  if (range && range.length === 2 && range[0] && range[1]) {   // ← ✅ ambos definidos
    const [from, to] = range;
    onChange({ type: 'custom', from, to });
  }
}, [option, range]);

  return (
    <div className="date-range-dropdown">
      <Dropdown
        value={option}
        options={OPTIONS}
        placeholder={placeholder}
        onChange={e => setOption(e.value)}
        className="w-full"
      />

      {option === 'custom' && (
        <div className="custom-calendar mt-2">
          <Calendar
            value={range}
            onChange={e => setRange(e.value)}
            selectionMode="range"
            placeholder="Selecciona rango"
            dateFormat="dd/mm/yy"
            className="w-full"
          />
        </div>
      )}
    </div>
  );
};

DateRangeDropdown.propTypes = {
  value: PropTypes.shape({
    type: PropTypes.string.isRequired,
    from: PropTypes.instanceOf(Date),
    to: PropTypes.instanceOf(Date)
  }),
  onChange: PropTypes.func.isRequired,
  placeholder: PropTypes.string
};

DateRangeDropdown.defaultProps = {
  value: { type: null },
  placeholder: 'Seleccionar rango'
};

export default DateRangeDropdown;
