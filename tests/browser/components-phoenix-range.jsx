import React from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import RangePicker from '@beisen-phoenix/date-picker/lib/RangePicker';
document.body.innerHTML = '<h1>北森真实范围日期 · 虚构测试</h1><section><h2>教育经历</h2><fieldset data-record="0"><div class="form-item"><label>起止时间</label><div id="range"></div></div></fieldset></section><pre id="accepted"></pre>';
function Fixture() {
  const [open, show] = React.useState(false), [dates, set] = React.useState([]);
  return <div className="range-date-picker"><input readOnly data-format="YYYY-MM-DD" value={dates[0] || ''} onClick={() => show(true)} /> ~
    <input readOnly data-format="YYYY-MM-DD" value={dates[1] || ''} onClick={() => show(true)} />
    {open && createPortal(<div style={{ position: 'fixed', left: 70, top: 220 }}><RangePicker showDateInput={false} onSelect={value => {
      if (!value[0] || !value[1]) return; const dates = value.map(date => date.format('YYYY-MM-DD')); set(dates); window.rangeAccepted = dates;
      document.getElementById('accepted').textContent = JSON.stringify(dates); show(false);
    }} /></div>, document.body)}</div>;
}
createRoot(document.getElementById('range')).render(<Fixture />);
window.rangeReady = true;
