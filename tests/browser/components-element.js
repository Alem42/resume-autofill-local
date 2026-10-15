import { createApp, h, ref } from 'vue';
import { ElDatePicker, ElSelect, ElOption } from 'element-plus';
import 'element-plus/dist/index.css';
import { setup, schools, degrees, levels } from './component-kit.js';
const kit = setup('Element Plus');
for (const [key, node] of Object.entries(kit.fields)) createApp({ setup() {
  const value = ref(); const change = next => { value.value = next; kit.accept(key)(next); };
  return () => /Date$/.test(key) ? h(ElDatePicker, { modelValue: value.value, 'onUpdate:modelValue': change, type: key === 'endDate' ? 'month' : 'date',
    valueFormat: key === 'endDate' ? 'YYYY-MM' : 'YYYY-MM-DD', editable: false, placeholder: '请输入' })
    : h(ElSelect, { modelValue: value.value, 'onUpdate:modelValue': change, filterable: key === 'school', placeholder: '请选择' }, () => (key === 'school' ? schools : key === 'degree' ? degrees : levels).map(option => h(ElOption, option)));
} }).mount(node);
kit.ready();
