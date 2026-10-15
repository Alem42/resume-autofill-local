import React from 'react';
import { createRoot } from 'react-dom/client';
import { DatePicker, Select } from '@arco-design/web-react';
import '@arco-design/web-react/dist/css/arco.css';
import { setup, schools, degrees, levels } from './component-kit.js';
const kit = setup('Arco Design React');
for (const [key, node] of Object.entries(kit.fields)) {
  function Field() {
    const [value, set] = React.useState();
    const change = value => { set(value); kit.accept(key)(value); };
    if (/Date$/.test(key)) { const Picker = key === 'endDate' ? DatePicker.MonthPicker : DatePicker;
      return <Picker value={value} onChange={change} editable={false} placeholder="请输入" />; }
    return <Select value={value} onChange={change} showSearch={key === 'school'} options={key === 'school' ? schools : key === 'degree' ? degrees : levels} placeholder="请选择" />;
  }
  createRoot(node).render(<Field />);
}
kit.ready();
