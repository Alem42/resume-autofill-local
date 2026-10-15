// rc-calendar is the upstream implementation observed in Sany's public Phoenix bundle.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import Calendar from 'rc-calendar';
import locale from 'rc-calendar/lib/locale/zh_CN';
import moment from 'moment';
import { setup, schools, degrees, levels } from './component-kit.js';
const kit = setup('Phoenix 日历上游 / 下拉 DOM 重建');
// The proprietary Phoenix select is not published as a test dependency. This
// fixture reproduces only the public DOM classes observed in its site bundle.
for (const key of ['school', 'degree', 'proficiency']) {
  function Choice() {
    const [value, set] = React.useState(), [query, search] = React.useState(''), [open, show] = React.useState(false), [busy, load] = React.useState(false);
    const options = key === 'school' ? schools : key === 'degree' ? degrees : levels;
    React.useEffect(() => { if (key !== 'school') return; load(true); const timer = setTimeout(() => load(false), 1500); return () => clearTimeout(timer); }, [query]);
    return <div className="phoenix-select" aria-busy={busy}>
      {value && <span className="phoenix-select__tipEle">{options.find(option => option.value === value)?.label}</span>}
      <input className="phoenix-select__input" placeholder="请选择" readOnly={key !== 'school'} value={query} onClick={() => show(true)} onChange={event => search(event.target.value)} />
      {open && createPortal(<div className="phoenix-single-select-list" style={{ position: 'fixed', left: 360, top: 190, background: 'white', padding: 12, zIndex: 3000 }}>
        <div className="phoenix-selectList__virtualList-holder-inner">{!busy && options.filter(option => !query || option.label.includes(query)).map(option =>
          <div key={option.value} className="phoenix-single-select-list__item" onClick={() => { set(option.value); search(''); show(false); kit.accept(key)(option.value); }} style={{ padding: 8 }}>{option.label}</div>)}</div>
      </div>, document.body)}
    </div>;
  }
  createRoot(kit.fields[key]).render(<Choice />);
}
for (const key of ['startDate', 'endDate']) {
  function Picker() {
    const [value, set] = React.useState(), [open, show] = React.useState(false), [mode, setMode] = React.useState(key === 'endDate' ? 'month' : 'date');
    const commit = date => { set(date); kit.accept(key)(date.format(key === 'endDate' ? 'YYYY-MM' : 'YYYY-MM-DD')); show(false); };
    return <div className="phoenix-date-picker"><input readOnly placeholder="请输入" value={value ? value.format(key === 'endDate' ? 'YYYY-MM' : 'YYYY-MM-DD') : ''} onClick={() => show(true)} />
      {open && createPortal(<Calendar prefixCls="phoenix-calendar" locale={locale} format={key === 'endDate' ? 'YYYY-MM' : 'YYYY-MM-DD'} defaultValue={moment('2026-10-16')}
        mode={mode} onSelect={commit} onPanelChange={(date, next) => { setMode(next); if (key === 'endDate' && next === 'date') commit(date); }} />, document.body)}
    </div>;
  }
  createRoot(kit.fields[key]).render(<Picker />);
}
kit.ready();
