"""레거시 I/F 18종 정의 (계획서 '레거시 I/F 정의' 표와 동일).

direction은 ERP 기준: IN = 레거시 → ERP, OUT = ERP → 레거시.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class IfDef:
    if_id: str
    system: str
    direction: str
    name: str


IF_CATALOG: list[IfDef] = [
    IfDef("IF-OMS-01", "OMS", "IN", "주문접수"),
    IfDef("IF-OMS-02", "OMS", "OUT", "진도정보"),
    IfDef("IF-OMS-03", "OMS", "OUT", "매출마감"),
    IfDef("IF-MES-01", "MES", "OUT", "생산지시"),
    IfDef("IF-MES-02", "MES", "IN", "생산실적·불량보고"),
    IfDef("IF-PMS-01", "PMS", "IN", "원지 투입·사용내역"),
    IfDef("IF-PMS-02", "PMS", "OUT", "원지입고·골게터 소요량"),
    IfDef("IF-EQ-01", "골게터 POP", "OUT", "원단 생산지시"),
    IfDef("IF-EQ-02", "골게터 POP", "IN", "실적·불량·가동상태"),
    IfDef("IF-EQ-03", "에볼/썬라이즈", "OUT", "생산지시"),
    IfDef("IF-EQ-04", "에볼/썬라이즈", "IN", "실적·불량·가동상태"),
    IfDef("IF-EQ-05", "인쇄 5호기", "OUT", "생산지시"),
    IfDef("IF-EQ-06", "인쇄 5호기", "IN", "실적·불량·가동상태"),
    IfDef("IF-EXT-01", "위아고", "OUT", "전자세금계산서 발행"),
    IfDef("IF-EXT-02", "로지스팟", "OUT", "상차정보·배차요청"),
    IfDef("IF-EXT-03", "오토콘", "OUT", "원단지시·현황"),
    IfDef("IF-EXT-04", "오토콘", "IN", "상자지시(원단 이송 완료)"),
    IfDef("IF-EXT-05", "더존", "OUT", "회계 전표(엑셀 내보내기)"),
]

IF_BY_ID = {d.if_id: d for d in IF_CATALOG}
