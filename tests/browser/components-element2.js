import Vue from 'vue';
import ElementUI from 'element-ui';
import 'element-ui/lib/theme-chalk/index.css';
import { setup, schools, degrees, levels } from './component-kit.js';
Vue.use(ElementUI);
const kit = setup('Element UI / Vue 2');
for (const [key, node] of Object.entries(kit.fields)) new Vue({ data: () => ({ value: '' }), render(h) {
  const change = value => { this.value = value; kit.accept(key)(value); };
  return /Date$/.test(key) ? h('el-date-picker', { props: { value: this.value, type: key === 'endDate' ? 'month' : 'date', valueFormat: key === 'endDate' ? 'yyyy-MM' : 'yyyy-MM-dd', editable: false, placeholder: '请输入' }, on: { input: change } })
    : h('el-select', { props: { value: this.value, filterable: key === 'school', placeholder: '请选择' }, on: { input: change } }, (key === 'school' ? schools : key === 'degree' ? degrees : levels).map(option => h('el-option', { props: option })));
} }).$mount(node);
kit.ready();
