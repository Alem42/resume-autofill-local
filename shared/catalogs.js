// Offline facts, not a claim that every recruiting site uses the same vocabulary.
export const CHOICES = Object.freeze({
  ethnicity: '汉族 回族 畲族 塔塔尔族 阿昌族 哈萨克族 土家族 景颇族 哈尼族 土族 白族 维吾尔族 保安族 赫哲族 乌孜别克族 基诺族 布依族 拉祜族 锡伯族 黎族 东乡族 蒙古族 仫佬族 达斡尔族 藏族 毛南族 裕固族 苗族 满族 壮族 彝族 侗族 瑶族 朝鲜族 佤族 水族 纳西族 傣族 傈僳族 高山族 柯尔克孜族 撒拉族 布朗族 塔吉克族 普米族 怒族 鄂温克族 德昂族 鄂伦春族 独龙族 门巴族 珞巴族 俄罗斯族 仡佬族 京族 羌族'.split(' '),
  political: '群众 中共党员 中共预备党员 入党积极分子 共青团员 民革党员 民盟盟员 民建会员 民进会员 农工党党员 致公党党员 九三学社社员 台盟盟员 无党派人士'.split(' '),
  relationship: '父亲 母亲 配偶 儿子 女儿 哥哥 姐姐 弟弟 妹妹 祖父 祖母 外祖父 外祖母 其他'.split(' '),
  language: '英语 汉语 日语 法语 德语 俄语 西班牙语 阿拉伯语 韩语 葡萄牙语 意大利语 粤语'.split(' '),
  proficiency: ['精通', '流利', '熟练', '良好', '一般', '基础'],
  degree: ['高中', '中专', '大专', '本科', '硕士研究生', '博士研究生'],
  degreeLevel: ['无', '学士', '硕士', '博士'],
  degreeDiscipline: '哲学 经济学 法学 教育学 文学 历史学 理学 工学 农学 医学 军事学 管理学 艺术学 交叉学科'.split(' '),
  studyMode: ['全日制', '非全日制', '在职', '函授', '自学考试', '成人教育', '网络教育'],
  health: ['健康', '良好', '一般'], gender: ['男', '女'], marital: ['未婚', '已婚'],
  idType: ['居民身份证', '护照', '港澳居民来往内地通行证', '台湾居民来往大陆通行证'],
  exam: ['IELTS', 'TOEFL', 'CET-4', 'CET-6', 'TEM-4', 'TEM-8', 'JLPT'],
  nationality: ['中国', '中国大陆'], highestDegree: ['高中', '中专', '大专', '本科', '硕士研究生', '博士研究生']
});
let cache;
export function loadDirectories() {
  return cache ||= Promise.all(['schools-cn.json', 'major-categories-cn.json', 'majors-cn.json'].map(async name => {
    const response = await fetch(new URL('../data/' + name, import.meta.url));
    if (!response.ok) throw new Error('离线目录读取失败');
    return response.json();
  })).then(([schools, categories, majors]) => ({ schools: schools.items, categories: categories.items, majors: majors.items }));
}
