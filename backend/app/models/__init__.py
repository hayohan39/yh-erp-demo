"""ORM 모델. 테이블 생성 시 모든 모델이 Base.metadata에 등록되도록 여기서 import 한다."""
from app.models.common import CommonCode, IfMessage  # noqa: F401
from app.models.master import BoardSpec, Equipment, ItemBox, PaperGrade, Partner  # noqa: F401
from app.models.sales import SalesOrder, SalesOrderLine  # noqa: F401
