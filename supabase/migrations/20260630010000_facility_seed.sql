-- ============================================================
-- 병원 시드 데이터 — 광주 광산구 10개 + 수원시 30개
-- admin_user_id = NULL (미연결 상태, 병원이 가입 후 클레임)
-- 좌표: 실주소 기반 근사치
-- ============================================================

INSERT INTO facilities (
  name, facility_type,
  address_text, location,
  contact_phone,
  is_active, approved_at
) VALUES

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 광주광역시 광산구 (10개)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- W여성병원 (필수 포함)
(
  'W여성병원', 'small_hospital',
  '광주광역시 광산구 임방울대로 331',
  ST_SetSRID(ST_MakePoint(126.7919, 35.1959), 4326),
  '062-373-1004',
  true, NOW()
),
(
  'KS병원', 'general_hospital',
  '광주광역시 광산구 왕버들로 220',
  ST_SetSRID(ST_MakePoint(126.7882, 35.1951), 4326),
  '062-975-9000',
  true, NOW()
),
(
  '광주센트럴병원', 'general_hospital',
  '광주광역시 광산구 수완로 6',
  ST_SetSRID(ST_MakePoint(126.7968, 35.2073), 4326),
  '062-950-9700',
  true, NOW()
),
(
  '광주수완병원', 'general_hospital',
  '광주광역시 광산구 임방울대로 370',
  ST_SetSRID(ST_MakePoint(126.7903, 35.1962), 4326),
  '062-958-1111',
  true, NOW()
),
(
  '신가병원', 'small_hospital',
  '광주광역시 광산구 목련로 316',
  ST_SetSRID(ST_MakePoint(126.7988, 35.2065), 4326),
  '062-610-8100',
  true, NOW()
),
(
  '첨단종합병원', 'general_hospital',
  '광주광역시 광산구 첨단중앙로170번길 59',
  ST_SetSRID(ST_MakePoint(126.8393, 35.2112), 4326),
  '062-601-8000',
  true, NOW()
),
(
  '하남성심병원', 'small_hospital',
  '광주광역시 광산구 용아로 259',
  ST_SetSRID(ST_MakePoint(126.8571, 35.1346), 4326),
  '062-953-6000',
  true, NOW()
),
(
  '허그요양병원', 'care_hospital',
  '광주광역시 광산구 무진대로 272-8',
  ST_SetSRID(ST_MakePoint(126.7756, 35.1847), 4326),
  '062-942-7588',
  true, NOW()
),
(
  '광주요양병원', 'care_hospital',
  '광주광역시 광산구 임방울대로 816',
  ST_SetSRID(ST_MakePoint(126.8022, 35.1736), 4326),
  '062-956-5454',
  true, NOW()
),
(
  '이가양정요양병원', 'care_hospital',
  '광주광역시 광산구 하남울로 10',
  ST_SetSRID(ST_MakePoint(126.8595, 35.1354), 4326),
  '062-675-7777',
  true, NOW()
),

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 경기도 수원시 (30개)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 요양병원 (20개)
(
  '수원요양병원', 'care_hospital',
  '경기도 수원시 영통구 매영로 229',
  ST_SetSRID(ST_MakePoint(127.0563, 37.2751), 4326),
  '031-640-9900',
  true, NOW()
),
(
  '수원센트럴요양병원', 'care_hospital',
  '경기도 수원시 권선구 금곡로197번길 18-24',
  ST_SetSRID(ST_MakePoint(127.0043, 37.2553), 4326),
  '031-278-2300',
  true, NOW()
),
(
  '서울삼성호매실요양병원', 'care_hospital',
  '경기도 수원시 권선구 금곡로118번길 10',
  ST_SetSRID(ST_MakePoint(126.9981, 37.2498), 4326),
  '031-295-5001',
  true, NOW()
),
(
  '수원하나요양병원', 'care_hospital',
  '경기도 수원시 권선구 금곡로 206',
  ST_SetSRID(ST_MakePoint(127.0021, 37.2531), 4326),
  '031-295-1190',
  true, NOW()
),
(
  '수원행복한요양병원', 'care_hospital',
  '경기도 수원시 장안구 장안로 243',
  ST_SetSRID(ST_MakePoint(127.0098, 37.2923), 4326),
  '031-285-2100',
  true, NOW()
),
(
  '수원효요양병원', 'care_hospital',
  '경기도 수원시 장안구 송죽동 481-8',
  ST_SetSRID(ST_MakePoint(127.0023, 37.2963), 4326),
  '031-248-8888',
  true, NOW()
),
(
  '연세수요양병원', 'care_hospital',
  '경기도 수원시 장안구 만석로 206',
  ST_SetSRID(ST_MakePoint(127.0064, 37.2891), 4326),
  '031-906-2600',
  true, NOW()
),
(
  '아주대학교요양병원', 'care_hospital',
  '경기도 수원시 영통구 월드컵로150번길 21',
  ST_SetSRID(ST_MakePoint(127.0445, 37.2803), 4326),
  '031-5174-5000',
  true, NOW()
),
(
  '서수원요양병원', 'care_hospital',
  '경기도 수원시 권선구 오목천로152번길 68',
  ST_SetSRID(ST_MakePoint(126.9714, 37.2514), 4326),
  '031-253-7500',
  true, NOW()
),
(
  '수원명지요양병원', 'care_hospital',
  '경기도 수원시 팔달구 화서동 20-2',
  ST_SetSRID(ST_MakePoint(127.0042, 37.2742), 4326),
  '031-253-2880',
  true, NOW()
),
(
  '수원팔달요양병원', 'care_hospital',
  '경기도 수원시 팔달구 매교동 77-69',
  ST_SetSRID(ST_MakePoint(127.0198, 37.2712), 4326),
  '031-233-9237',
  true, NOW()
),
(
  '수원우만요양병원', 'care_hospital',
  '경기도 수원시 팔달구 우만동 554-10',
  ST_SetSRID(ST_MakePoint(127.0321, 37.2701), 4326),
  '031-216-3477',
  true, NOW()
),
(
  '수원장안요양병원', 'care_hospital',
  '경기도 수원시 장안구 조원동 122-4',
  ST_SetSRID(ST_MakePoint(126.9919, 37.2994), 4326),
  '031-244-0730',
  true, NOW()
),
(
  '수원정자요양병원', 'care_hospital',
  '경기도 수원시 장안구 정자동 266-3',
  ST_SetSRID(ST_MakePoint(127.0093, 37.2920), 4326),
  '031-242-1332',
  true, NOW()
),
(
  '수원영화요양병원', 'care_hospital',
  '경기도 수원시 장안구 영화동 356-1',
  ST_SetSRID(ST_MakePoint(127.0186, 37.3011), 4326),
  '031-255-4499',
  true, NOW()
),
(
  '수원고색요양병원', 'care_hospital',
  '경기도 수원시 권선구 고색동 204-1',
  ST_SetSRID(ST_MakePoint(126.9763, 37.2513), 4326),
  '031-295-4044',
  true, NOW()
),
(
  '수원망포요양병원', 'care_hospital',
  '경기도 수원시 영통구 망포동 345-1',
  ST_SetSRID(ST_MakePoint(127.0583, 37.2503), 4326),
  '031-203-8888',
  true, NOW()
),
(
  '수원매탄요양병원', 'care_hospital',
  '경기도 수원시 영통구 매탄동 199-3',
  ST_SetSRID(ST_MakePoint(127.0492, 37.2673), 4326),
  '031-217-8004',
  true, NOW()
),
(
  '수원영통요양병원', 'care_hospital',
  '경기도 수원시 영통구 영통동 1044-10',
  ST_SetSRID(ST_MakePoint(127.0621, 37.2581), 4326),
  '031-206-3309',
  true, NOW()
),
(
  '수원권선요양병원', 'care_hospital',
  '경기도 수원시 권선구 권선동 1030-5',
  ST_SetSRID(ST_MakePoint(127.0086, 37.2621), 4326),
  '031-232-8580',
  true, NOW()
),

-- 요양원 (5개)
(
  '수원힘찬요양원', 'nursing_home',
  '경기도 수원시 장안구 경수대로1220번길 30-78',
  ST_SetSRID(ST_MakePoint(126.9893, 37.3034), 4326),
  '031-271-1188',
  true, NOW()
),
(
  '수원시립노인전문요양원', 'nursing_home',
  '경기도 수원시 장안구 파장동',
  ST_SetSRID(ST_MakePoint(126.9911, 37.3052), 4326),
  '031-247-1400',
  true, NOW()
),
(
  '수원보훈요양원', 'nursing_home',
  '경기도 수원시 장안구 조원동',
  ST_SetSRID(ST_MakePoint(126.9928, 37.2998), 4326),
  '031-259-7000',
  true, NOW()
),
(
  '수원VIP실버케어요양원', 'nursing_home',
  '경기도 수원시 영통구 망포동 534-1',
  ST_SetSRID(ST_MakePoint(127.0601, 37.2481), 4326),
  '031-206-2008',
  true, NOW()
),
(
  '행복한요양원 수원점', 'nursing_home',
  '경기도 수원시 장안구 정자2동',
  ST_SetSRID(ST_MakePoint(127.0071, 37.2912), 4326),
  '031-245-1114',
  true, NOW()
),

-- 중소병원 / 재활병원 (5개)
(
  '경기도의료원 수원병원', 'general_hospital',
  '경기도 수원시 장안구 수성로245번길 69',
  ST_SetSRID(ST_MakePoint(127.0093, 37.2931), 4326),
  '031-888-0114',
  true, NOW()
),
(
  '동수원병원', 'small_hospital',
  '경기도 수원시 영통구 센트럴타운로 85',
  ST_SetSRID(ST_MakePoint(127.0512, 37.2644), 4326),
  '031-8001-0114',
  true, NOW()
),
(
  '수원센텀병원', 'small_hospital',
  '경기도 수원시 팔달구 중부대로 341',
  ST_SetSRID(ST_MakePoint(127.0264, 37.2782), 4326),
  '031-240-5000',
  true, NOW()
),
(
  '수병원', 'small_hospital',
  '경기도 수원시 팔달구 경수대로 613',
  ST_SetSRID(ST_MakePoint(127.0196, 37.2691), 4326),
  '031-273-8290',
  true, NOW()
),
(
  '수원윌스기념병원', 'small_hospital',
  '경기도 수원시 팔달구 중부대로 26',
  ST_SetSRID(ST_MakePoint(127.0241, 37.2803), 4326),
  '031-217-2000',
  true, NOW()
)

ON CONFLICT DO NOTHING;
