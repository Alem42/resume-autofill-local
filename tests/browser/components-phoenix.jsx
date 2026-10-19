// Actual publicly published Phoenix 3.3.55, isolated test dependencies only.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import Select from '@beisen-phoenix/select';
import SelectList from '@beisen-phoenix/select-list';
import DatePicker from '@beisen-phoenix/date-picker/lib/DatePicker';
import MonthPicker from '@beisen-phoenix/date-picker/lib/MonthPicker';
import moment from 'moment';
import { setup, schools, degrees, levels } from './component-kit.js';
const kit = setup('北森 Phoenix 3.3.55（实际公开包）');
for (const key of ['school', 'degree', 'proficiency']) {
  function Choice() {
    const [value, set] = React.useState(), [query, search] = React.useState(''), [open, show] = React.useState(false), [busy, load] = React.useState(false);
    const options = key === 'school' ? schools : key === 'degree' ? degrees : levels;
    React.useEffect(() => { if (key !== 'school') return; load(true); const timer = setTimeout(() => load(false), 1600); return () => clearTimeout(timer); }, [query]);
    return <><Select value={options.find(option => option.value === value)?.label || ''} isSearch={key === 'school'} isActive={open}
      onClick={() => show(true)} onSearch={search} onChange={({ searchWord }) => search(searchWord || '')} />
      {open && createPortal(<div className="phoenix-select-popup" role="listbox" style={{ position: 'fixed', left: 360, top: 190, width: 420, background: 'white', padding: 12, zIndex: 3000 }}>
        <SelectList options={options.filter(option => !query || option.label.includes(query))} loading={busy} selectedOptions={options.find(option => option.value === value)}
          onSelect={({ selectOption }) => { set(selectOption.value); search(''); show(false); kit.accept(key)(selectOption.value); }} />
      </div>, document.body)}</>;
  }
  createRoot(kit.fields[key]).render(<Choice />);
}
for (const key of ['startDate', 'endDate']) {
  function Picker() {
    const [value, set] = React.useState(), [open, show] = React.useState(false);
    const commit = date => { set(date); kit.accept(key)(date.format(key === 'endDate' ? 'YYYY-MM' : 'YYYY-MM-DD')); show(false); };
    const Panel = key === 'endDate' ? MonthPicker : DatePicker;
    return <div className="phoenix-picker-field"><input readOnly data-format={key === 'endDate' ? 'YYYY-MM' : 'YYYY-MM-DD'} placeholder="请选择日期"
      value={value ? value.format(key === 'endDate' ? 'YYYY-MM' : 'YYYY-MM-DD') : ''} onClick={() => show(true)} />
      {open && createPortal(<div style={{ position: 'fixed', left: 360, top: 100, zIndex: 3000 }}><Panel
        value={value || moment('2026-10-16')} onSelect={commit} /></div>, document.body)}
    </div>;
  }
  createRoot(kit.fields[key]).render(<Picker />);
}
kit.ready();
