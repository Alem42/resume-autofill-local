import { createApp, h, ref } from 'vue';
import { DatePicker, Select } from 'tdesign-vue-next';
import 'tdesign-vue-next/es/style/index.css';
import { setup, schools, degrees, levels } from './component-kit.js';
const kit = setup('TDesign Vue Next');
for (const [key, node] of Object.entries(kit.fields)) createApp({ setup() {
  const value = ref(); const change = next => { value.value = next; kit.accept(key)(next); };
  return () => /Date$/.test(key) ? h(DatePicker, { value: value.value, onChange: change, mode: key === 'endDate' ? 'month' : 'date', format: key === 'endDate' ? 'YYYY-MM' : 'YYYY-MM-DD', valueType: key === 'endDate' ? 'YYYY-MM' : 'YYYY-MM-DD', allowInput: false, placeholder: '请输入' })
    : h(Select, { value: value.value, onChange: change, filterable: key === 'school', options: key === 'school' ? schools : key === 'degree' ? degrees : levels, placeholder: '请选择' });
} }).mount(node);
kit.ready();
