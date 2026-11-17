// 기본 요금·감액 데이터 (2026 개정 요금체계 기준)
// ⚠ 출시 전 우정사업본부 최신 계약소포 요금·감액 고시 및 업무처리지침과 대조하세요.
//   앱의 [설정] 탭에서 금액을 수정할 수 있으며, 수정값은 기기에 저장됩니다.

window.DEFAULT_TARIFF = {
  version: '2026 개정 요금체계 (검증 필요)',

  // 월 평균 물량 구간
  volumes: [
    '100통 이상', '300통 이상', '500통 이상', '1,000통 이상', '3,000통 이상',
    '5,000통 이상', '10,000통 이상', '20,000통 이상', '30,000통 이상',
    '50,000통 이상', '100,000통 이상'
  ],
  defaultVolume: 6,

  // 중량 규격
  //  baseFrom: 기준요금 열 번호(rates의 열), discountable: 감액 적용 여부, size: 크기 기준
  specs: [
    { name: '초소형', size: '1kg/50cm',  baseFrom: 0, discountable: true },
    { name: '2kg',   size: '80cm',      baseFrom: 0, discountable: true },
    { name: '5kg',   size: '100cm',     baseFrom: 1, discountable: true },
    { name: '10kg',  size: '120cm',     baseFrom: 2, discountable: true },
    { name: '20kg',  size: '140cm',     baseFrom: 3, discountable: false },
    { name: '30kg',  size: '160cm',     baseFrom: 4, discountable: false }
  ],

  // 15kg(140cm) 선택 규격: 10kg 규격 요금 + addOn
  option15: { name: '15kg', size: '140cm', fromSpec: 3, addOn: 1000, insertAfter: 3 },

  // 물량 구간별 기준요금 [2kg, 5kg, 10kg, 20kg, 30kg] (원)
  rates: [
    [3050, 3300, 3800, 7300, 10300],
    [2950, 3200, 3700, 7200, 10200],
    [2850, 3100, 3600, 7100, 10100],
    [2750, 3000, 3500, 7000, 10000],
    [2650, 2900, 3400, 6900, 9900],
    [2600, 2850, 3350, 6850, 9850],
    [2550, 2800, 3300, 6800, 9800],
    [2500, 2750, 3250, 6750, 9750],
    [2450, 2700, 3200, 6700, 9700],
    [2400, 2650, 3150, 6650, 9650],
    [2350, 2600, 3100, 6600, 9600]
  ],

  // 계약 기간별 감액 한도 (한도 적용 항목의 합계 기준)
  limits: [
    { minYears: 3, amount: 600 },
    { minYears: 1, amount: 550 },
    { minYears: 0, amount: 500 }
  ],

  // 감액 항목 (섹션별)
  //  minVolume: 적용 가능한 최소 물량 구간 번호(volumes 기준)
  //  group: 같은 그룹 안에서는 하나만 선택
  //  specs: 적용 규격 번호 목록(null = 감액 가능한 전 규격)
  //  outsideLimit: true면 감액 한도 계산에서 제외
  //  oneSpec: true면 사용자가 고른 규격 하나에만 적용
  //  years: 적용 가능한 계약 기간 (0: 1년 미만=신규, 1: 1년 이상, 3: 3년 이상). 없으면 기간 무관
  //         지침: 신규 감액은 최초 계약기간(1년 이내)만, 장기 감액은 유지기간 1년 이상/3년 이상으로 구분
  sections: [
    { title: '1. 소통·협조 감액', ids: ['sys', 'tr1', 'tr2', 'easy', 'code'] },
    { title: '2. 신규 감액 (계약 1년 이내)', ids: ['new1', 'new2', 'new3', 'new4'] },
    { title: '3. 장기 감액', ids: ['long1a', 'long1b', 'long2a', 'long2b', 'long3a', 'long3b', 'long4a', 'long4b'] },
    { title: '4. 초소형 감액', ids: ['mini'] }
  ],
  discounts: [
    { id: 'sys',    name: '가. 계약고객 전용시스템 이용',        amount: 100, minVolume: 0, group: null,        specs: null, outsideLimit: false },
    { id: 'tr1',    name: '나-1. 고객 운송 — 우체국까지',        amount: 200, minVolume: 1, group: 'transport', specs: null, outsideLimit: true },
    { id: 'tr2',    name: '나-2. 고객 운송 — 집중국(물류센터)까지', amount: 400, minVolume: 1, group: 'transport', specs: null, outsideLimit: true },
    { id: 'easy',   name: '다. 계약소포 간편접수 (1개 규격)',    amount: 30,  minVolume: 1, group: null,        specs: null, outsideLimit: false, oneSpec: true },
    { id: 'code',   name: '라. 집배코드·구분코스 인쇄',          amount: 50,  minVolume: 0, group: null,        specs: null, outsideLimit: false },

    { id: 'new1',   name: '마-1. 월평균 1,000통 이상',   amount: 50,  minVolume: 3, group: 'tenure', specs: null, outsideLimit: false, years: [0] },
    { id: 'new2',   name: '마-2. 월평균 10,000통 이상',  amount: 100, minVolume: 6, group: 'tenure', specs: null, outsideLimit: false, years: [0] },
    { id: 'new3',   name: '마-3. 월평균 20,000통 이상',  amount: 150, minVolume: 7, group: 'tenure', specs: null, outsideLimit: false, years: [0] },
    { id: 'new4',   name: '마-4. 월평균 30,000통 이상',  amount: 200, minVolume: 8, group: 'tenure', specs: null, outsideLimit: false, years: [0] },

    { id: 'long1a', name: '바-1a. 월평균 1,000통 (1년 이상)',  amount: 100, minVolume: 3, group: 'tenure', specs: null, outsideLimit: false, years: [1] },
    { id: 'long1b', name: '바-1b. 월평균 1,000통 (3년 이상)',  amount: 150, minVolume: 3, group: 'tenure', specs: null, outsideLimit: false, years: [3] },
    { id: 'long2a', name: '바-2a. 월평균 10,000통 (1년 이상)', amount: 150, minVolume: 6, group: 'tenure', specs: null, outsideLimit: false, years: [1] },
    { id: 'long2b', name: '바-2b. 월평균 10,000통 (3년 이상)', amount: 200, minVolume: 6, group: 'tenure', specs: null, outsideLimit: false, years: [3] },
    { id: 'long3a', name: '바-3a. 월평균 20,000통 (1년 이상)', amount: 200, minVolume: 7, group: 'tenure', specs: null, outsideLimit: false, years: [1] },
    { id: 'long3b', name: '바-3b. 월평균 20,000통 (3년 이상)', amount: 250, minVolume: 7, group: 'tenure', specs: null, outsideLimit: false, years: [3] },
    { id: 'long4a', name: '바-4a. 월평균 30,000통 (1년 이상)', amount: 250, minVolume: 8, group: 'tenure', specs: null, outsideLimit: false, years: [1] },
    { id: 'long4b', name: '바-4b. 월평균 30,000통 (3년 이상)', amount: 300, minVolume: 8, group: 'tenure', specs: null, outsideLimit: false, years: [3] },

    { id: 'mini',   name: '사. 초소형 소포 (1kg/50cm 이하)', amount: 100, minVolume: 3, group: null, specs: [0], outsideLimit: true }
  ],
  defaultChecked: ['sys', 'code'],

  // 50원 단위로 고르는 감액
  steps: [
    { id: 'special', name: '5. 특별 감액',     desc: '지방우정청장·총괄국장 감액', max: 200, unit: 50, minVolume: 1, specs: null,      outsideLimit: false },
    { id: 'small',   name: '6. 소상공인 감액', desc: '초소형·2kg·5kg 적용',        max: 200, unit: 50, minVolume: 0, specs: [0, 1, 2], outsideLimit: true }
  ],

  // 계약소포 규격 적용 시 허용한도 (업무처리지침 29쪽, [별표 3] 2.)
  tolerance: {
    source: '업무처리지침 29쪽 [별표 3] 2.',
    weight: { note: '단, 30kg은 허용한도 없음', rows: [['2kg', '2.5kg'], ['5kg', '6kg'], ['10kg', '12kg'], ['20kg', '22kg'], ['30kg', '없음']] },
    size:   { note: '단, 160cm는 허용한도 없음', rows: [['80cm', '85cm'], ['100cm', '105cm'], ['120cm', '130cm'], ['140cm', '150cm'], ['160cm', '없음']] },
    oversize: [
      '접수 크기의 최대한도는 160cm 이하가 원칙입니다.',
      '다량 계약소포 마케팅에 필요한 경우 200cm 이하까지 접수할 수 있습니다. (이때 한 변의 최대 길이는 130cm 이하)',
      '크기 초과 우편물의 접수요금은 30kg(160cm) 규격·물량단계별 요금의 150% 이상을 적용합니다.'
    ]
  },

  // 제안서 안내 사항
  notes: [
    { title: '부가이용료', items: ['도서지역(제주행 포함) 400원 추가', '착불요금 500원 추가'] },
    { title: '계약 적용 기준', items: ['최초 계약 3개월은 계약 물량 기준으로 요금을 적용하고, 이후에는 직전 3개월 월평균 발송 물량으로 요금을 적용합니다. (부가취급·계약 형태는 별도 협의)'] },
    { title: '반송수수료', items: [
      '수취거절·수취인불명·주소불명 등으로 반송된 우편물에는 반송료가 부과됩니다.',
      '연간 계약업체는 아래 범위 안에서 반송료를 면제합니다.',
      '월 1천통 미만: 월 발송물량의 3%',
      '월 1천통 이상 1만통 미만: 월 발송물량의 4%',
      '월 1만통 이상: 월 발송물량의 5%'
    ] }
  ]
};
