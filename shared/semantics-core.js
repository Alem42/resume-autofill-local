// Pure rules shared by the worker and the isolated content-script world.
(() => {
  if (globalThis.__resumeSemantics) return;
  const titles = Object.freeze({ basic: '基本信息', education: '教育经历', work: '工作经历',
    internships: '实习经历', employment: '实习 / 工作经历', projects: '项目经历', awards: '获奖信息',
    campus: '校园经历', research: '科研经历', publications: '论文发表', patents: '专利信息',
    languageCertificates: '语言考试', professionalCertificates: '资格证书', qualifications: '语言 / 证书 / 技能', training: '培训经历',
    volunteer: '志愿经历', portfolio: '作品集', jobIntention: '求职意向', other: '其他信息', unknown: '未识别区块' });
  const patterns = {
    education: /教育(?:经历|背景|信息)|学习经历|学历(?:信息|学位)|education|academic background/i,
    internships: /实习(?:经历|经验|信息)|internship/i,
    work: /工作(?:经历|经验|信息)|任职经历|职业经历|work experience|employment history/i,
    projects: /项目(?:经历|经验|信息)|项目实践|project(?:s| experience)?/i,
    awards: /获奖|奖项|荣誉|奖励(?:信息|情况)|奖学金|award|honou?r/i,
    campus: /校园(?:经历|活动)|校内(?:经历|活动|职务)|社团|学生(?:干部|工作)|社会实践|campus|extracurricular/i,
    research: /科研(?:经历|经验|项目)|研究经历|research experience/i,
    publications: /论文(?:发表|信息|成果)?|学术发表|publication|paper/i,
    patents: /专利|patent/i,
    languageCertificates: /语言(?:能力|考试|水平)|外语|language|语言证书/i,
    professionalCertificates: /资格证书|专业证书|职业证书|证书信息|certification|certificate/i,
    training: /培训(?:经历|信息)|进修经历|training/i,
    volunteer: /志愿|公益(?:经历|活动)|volunteer/i,
    portfolio: /作品集|作品(?:展示|信息)|portfolio/i,
    jobIntention: /求职意向|应聘意向|工作意向|job preference|career objective/i,
    basic: /基本(?:信息|资料)|个人(?:信息|资料)|联系方式|personal information|contact information/i
  };
  const compact = value => String(value || '').replace(/[\s_\-：:*＊()（）]/g, '').toLowerCase();
  function section(text) {
    const value = String(text || '').slice(0, 180);
    if (/语言\s*[/、]\s*证书\s*[/、]\s*技能|语言.*证书.*技能/i.test(value)) return 'qualifications';
    if (/实习\s*[/、和与&-]\s*工作|工作\s*[/、和与&-]\s*实习|(?:work.*internship|internship.*work)/i.test(value)) return 'employment';
    const hits = Object.entries(patterns).filter(([, re]) => re.test(value)).map(([key]) => key);
    // A research-project heading is academic research rather than a second project category.
    if (hits.includes('research') && hits.length === 2 && hits.includes('projects')) return 'research';
    return hits.length === 1 ? hits[0] : 'unknown';
  }
  function headingSection(text) {
    const value = compact(text).replace(/(?:选填|必填|非必填)$/, '');
    const aliases = {
      basic: /^(基本信息|基本资料|个人信息|个人资料|联系方式|personalinformation|contactinformation)$/,
      education: /^(教育经历|教育背景|教育信息|学历信息|学历学位|学习经历|education|academicbackground)$/,
      work: /^(工作经历|工作经验|任职经历|职业经历|workexperience|employmenthistory)$/,
      internships: /^(实习经历|实习经验|实习信息|internship|internships)$/,
      employment: /^(实习[/、和与&]?工作(?:经历|经验)?|工作[/、和与&]?实习(?:经历|经验)?|workandinternship)$/,
      projects: /^(项目经历|项目经验|项目实践|项目信息|project|projects|projectexperience)$/,
      awards: /^(获奖|奖项|荣誉|获奖信息|获奖情况|荣誉奖励|荣誉奖项|荣誉奖励信息|奖项信息|奖励信息|奖励情况|awards?|honou?rs?)$/,
      campus: /^(校园经历|校园活动|校内经历|社团经历|学生工作|社会实践|campus|extracurricular)$/,
      research: /^(科研经历|科研项目|研究经历|research|researchexperience)$/,
      publications: /^(论文|论文发表|论文成果|论文信息|论文\/期刊|学术发表|publications?)$/,
      patents: /^(专利|专利信息|专利成果|发明成果专利|patents?)$/,
      languageCertificates: /^(语言能力|语言考试|语言水平|外语|语言证书|language)$/,
      professionalCertificates: /^(资格证书|专业证书|职业证书|证书信息|certificates?|certifications?)$/,
      qualifications: /^(语言\/证书\/技能|语言证书技能)$/,
      training: /^(培训经历|培训信息|进修经历|training)$/,
      volunteer: /^(志愿经历|志愿活动|公益经历|公益活动|volunteer)$/,
      portfolio: /^(作品集|作品展示|作品信息|portfolio)$/,
      jobIntention: /^(求职意向|应聘意向|工作意向|jobpreference|careerobjective)$/,
      other: /^(其他信息|技能|专业技能|自我评价|兴趣爱好|otherinformation)$/
    };
    return Object.entries(aliases).find(([, pattern]) => pattern.test(value))?.[0] || 'unknown';
  }
  function inferSection(text) {
    const value = compact(text);
    if (value === '最高学历') return 'basic';
    if (/^(专业技能|技能|自我评价|自我介绍|兴趣爱好|补充信息|skills|selfevaluation)$/.test(value)) return 'other';
    if (/预计毕业|预期毕业|expectedgraduation/.test(value)) return 'basic';
    if (/学校名称|毕业院校|就读院校|schoolname|education|学历|学位|所学专业/.test(value)) return 'education';
    if (/实习单位|实习公司|internship/.test(value)) return 'internships';
    if (/公司名称|工作单位|雇主|工作描述|companyname|employer|workdescription/.test(value)) return 'work';
    if (/项目名称|项目描述|项目角色|projectname|projectdescription|projectrole/.test(value)) return 'projects';
    if (/奖项名称|获奖名称|荣誉名称|awardname|获奖时间|颁奖/.test(value)) return 'awards';
    if (/论文题目|论文名称|期刊名称|papertitle|publicationtitle/.test(value)) return 'publications';
    if (/专利名称|专利号|patent/.test(value)) return 'patents';
    if (/期望职位|期望薪资|期望城市|意向城市|意向职位/.test(value)) return 'jobIntention';
    if (/^(?:请输入|请填写|请选择)?(?:姓名|性别|手机号|手机号码|联系电话|邮箱|电子邮箱|出生日期|出生年月|现居城市|所在城市|籍贯|民族|政治面貌|name|email|phone|mobile|gender|birthday)$/.test(value)) return 'basic';
    return 'unknown';
  }
  const anchors = {
    education: /^(学校|学校名称|毕业院校|就读院校|院校|school|schoolname|university)$/i,
    work: /^(公司|公司名称|工作单位|单位名称|company|companyname|employer)$/i,
    internships: /^(实习公司|实习单位|公司名称|公司|company|companyname|employer)$/i,
    employment: /^(实习公司|实习单位|公司|公司名称|工作单位|单位名称|company|companyname|employer)$/i,
    projects: /项目名称|项目名|project.?name/i, awards: /奖项名称|获奖名称|荣誉名称|award.?name/i,
    campus: /活动名称|组织名称|社团名称|activity.?name/i, research: /课题名称|研究名称|科研项目|research.?name/i,
    publications: /论文名称|论文题目|paper.?title/i, patents: /专利名称|patent.?name/i,
    languageCertificates: /语言名称|语种|language.?name/i, professionalCertificates: /证书名称|certificate.?name/i,
    qualifications: /语言名称|语种|考试名称|证书名称|language.?name|certificate.?name/i,
    training: /培训名称|课程名称|training.?name/i, volunteer: /活动名称|项目名称|volunteer.?name/i,
    portfolio: /作品名称|作品名|portfolio.?name/i
  };
  const contextualFields = {
    awards: { name: /^(奖项名称|获奖名称|荣誉名称|awardname)$/, category: /^(奖项类别|获奖类别|奖项类型)$/,
      level: /^(奖项级别|获奖级别|荣誉级别)$/, rank: /^(奖项等级|获奖等级|奖励等级|奖项等次)$/,
      date: /^(获奖时间|获奖日期|获奖年月|awarddate)$/, description: /^(获奖内容|获奖事迹)$/ },
    projects: { role: /^(项目角色|担任角色)$/, responsibilities: /^(个人职责|个人贡献|个人职责\/贡献)$/,
      achievements: /^(项目成果|项目成效)$/, description: /^(项目描述|项目内容)$/ },
    research: { name: /^(课题名称|研究名称|科研项目名称|项目名称)$/ },
    campus: { name: /^(活动名称|社团名称|活动\/社团名称)$/ },
    volunteer: { name: /^(志愿活动名称|活动名称|项目名称)$/ },
    portfolio: { name: /^(作品名称|作品名)$/ },
    training: { name: /^(培训名称|课程名称|培训\/课程名称)$/ },
    publications: { title: /^(论文名称|论文题目|论文标题)$/, venue: /^(期刊名称|会议名称|期刊\/会议名称)$/ },
    patents: { name: /^(专利名称)$/, number: /^(专利号|申请号|申请\/专利号)$/ },
    languageCertificates: { language: /^(语种|语言名称|语言类型)$/, exam: /^(考试名称)$/, score: /^(考试成绩|语言成绩)$/ },
    professionalCertificates: { name: /^(证书名称)$/, number: /^(证书编号)$/ }
  };
  function fieldKind(text, scope) {
    const v = compact(text).replace(/^(?:请输入|请选择|请填写|填写|选择)/, '');
    if (/预计毕业|预期毕业|expectedgraduation/.test(v)) return 'expectedGraduationDate';
    if (scope === 'basic' && /毕业(?:时间|年月|日期)|graduationdate/.test(v)) return 'expectedGraduationDate';
    const contextual = Object.entries(contextualFields[scope] || {}).find(([, pattern]) => pattern.test(v));
    if (contextual) return contextual[0];
    const basicKeys = {
      name: /^(姓名|中文姓名|真实姓名|name|fullname)$/, gender: /^(性别|gender|sex)$/,
      phone: /^(手机|手机号|手机号码|联系电话|移动电话|phone|mobile|telephone)$/,
      email: /^(邮箱|电子邮箱|电子邮件|email|emailaddress)$/,
      nationality: /^(国籍|国家\/地区)$/, nativePlace: /^(籍贯)$/,
      ethnicity: /^(民族)$/, location: /^(所在城市|现居城市|现居住地|居住城市)$/,
      birthday: /^(出生日期|出生年月|出生时间|生日|birthday|dateofbirth)$/,
      wechat: /^(微信|微信号)$/, idCard: /^(身份证号|身份证号码|证件号码)$/, interests: /^(兴趣爱好|爱好)$/
    };
    const basic = Object.entries(basicKeys).find(([, pattern]) => pattern.test(v));
    if (basic) return basic[0];
    if (/结束|毕业(?:时间|年月|日期)|离职|enddate|endtime|graduationdate/.test(v)) return 'endDate';
    if (/开始|入学|入职|起始|startdate|starttime/.test(v)) return 'startDate';
    if (/^(学校|学校名称|毕业院校|就读院校|school|schoolname|university)$/.test(v)) return 'school';
    if (/^(专业|专业名称|所学专业|major|majorname)$/.test(v)) return 'major';
    if (/^(学历|最高学历|educationlevel|qualification)$/.test(v)) return 'degree';
    if (/^(学位|学位名称|degreename)$/.test(v)) return 'degreeName';
    if (/^(公司|公司名称|工作单位|实习单位|company|companyname|employer)$/.test(v)) return 'company';
    if (/^(项目名称|项目名|projectname)$/.test(v)) return 'projectName';
    return null;
  }
  globalThis.__resumeSemantics = Object.freeze({ titles, section, headingSection, inferSection, fieldKind,
    isAnchor: (key, text) => Boolean(anchors[key]?.test(String(text || ''))),
    repeated: Object.freeze(Object.keys(anchors)) });
})();
