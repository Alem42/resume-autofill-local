import React from 'react';
import { createRoot } from 'react-dom/client';
import { setup, expected, schools, degrees, levels } from './component-kit.js';
import { DatePicker, Select, ConfigProvider } from 'antd';
import locale from 'antd/locale/zh_CN';
const kit = setup('Ant Design React');
for (const [key, node] of Object.entries(kit.fields)) {
  function Field() {
    const [value, set] = React.useState();
    const change = (value, formatted) => { set(value); kit.accept(key)(typeof formatted === 'string' ? formatted : value); };
    const child = /Date$/.test(key) ? <DatePicker value={value} onChange={change} picker={key === 'endDate' ? 'month' : 'date'} inputReadOnly placeholder="请输入" />
      : <Select value={value} onChange={change} showSearch={key === 'school'} options={key === 'school' ? schools : key === 'degree' ? degrees : levels} placeholder="请选择" style={{ width: '100%' }} />;
    return <ConfigProvider locale={locale}>{child}</ConfigProvider>;
  }
  createRoot(node).render(<Field />);
}
kit.ready();
