import { createApp, h, ref } from 'vue';
import { NDatePicker, NSelect } from 'naive-ui';
import { setup, schools, degrees, levels } from './component-kit.js';
const kit = setup('Naive UI');
for (const [key, node] of Object.entries(kit.fields)) createApp({ setup() {
  const value = ref(); const change = next => { value.value = next; kit.accept(key)(next); };
  return () => /Date$/.test(key) ? h(NDatePicker, { formattedValue: value.value, 'onUpdate:formattedValue': change, type: key === 'endDate' ? 'month' : 'date', valueFormat: key === 'endDate' ? 'yyyy-MM' : 'yyyy-MM-dd', inputReadonly: true, placeholder: '请输入' })
    : h(NSelect, { value: value.value, 'onUpdate:value': change, filterable: key === 'school', options: key === 'school' ? schools : key === 'degree' ? degrees : levels, placeholder: '请选择' });
} }).mount(node);
kit.ready();
