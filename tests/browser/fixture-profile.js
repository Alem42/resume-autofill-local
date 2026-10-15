// Fictional data only. Reserved example.invalid address and an unusable phone number.
export const fixtureProfile = {
  basic: { name: '测试同学', gender: '女', phone: '00000000000', email: 'resume-test@example.invalid',
    birthday: '2000-03-14', nationality: '中国大陆', ethnicity: '汉', location: '杭州', nativePlace: '浙江',
    highestDegree: '硕士', expectedGraduationDate: '2027-06', political: '共青团员' },
  education: [
    { school: '演示海川大学(Demo Haichuan University)', college: '计算机学院', major: '计算机科学与技术', majorCategory: '工学',
      degree: '硕士', studyMode: '全日制', isHighest: true, doubleDegree: false, startDate: '2024-09-13', endDate: '2027-06-22' },
    { school: '演示星河学院(Demo Xinghe College)', college: '信息工程学院', major: '软件工程', majorCategory: '工学',
      degree: '本科', studyMode: '全日制', isHighest: false, doubleDegree: false, startDate: '2020-09-07', endDate: '2024-06-18' }
  ],
  internships: [{ company: '虚构科技实验室', position: '研发实习生', startDate: '2025-07-03', endDate: '2025-09-26', description: '参与虚构服务的单元测试与文档维护。' }],
  projects: [
    { projectName: '演示知识库', role: '独立开发', startDate: '2025-03-12', endDate: '2025-07-23', description: '用于控件兼容性测试的虚构项目，包含检索、索引和结果校验。' },
    { projectName: '演示数据管道', role: '开发成员', startDate: '2024-10-08', endDate: '2025-02-16', description: '用于测试多条记录的虚构项目，验证异步输入事件。' },
    { projectName: '演示可视化', role: '负责人', startDate: '2023-04-11', endDate: '2023-12-19', description: '用于测试不同日期精度的虚构项目。' }
  ],
  campus: [{ name: '虚构技术社团', organization: '演示学生社团', role: '组织者', startDate: '2021-09-10', endDate: '2023-06-20', description: '组织虚构技术交流活动。' }],
  awards: [{ name: '演示创新奖', level: '校级', rank: '一等奖', date: '2023-11-16', description: '虚构奖项，仅用于测试。' }],
  languageCertificates: [{ language: '英语', proficiency: '精通', exam: 'IELTS', score: '6.5', date: '2025-05-17' }],
  selfEvaluation: '这是完全虚构的测试资料。', interests: '阅读、摄影'
};
