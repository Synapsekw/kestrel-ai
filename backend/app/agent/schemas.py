from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.errors import AppError
from app.providers.schemas import ProviderName
from app.training.starter import STARTER_KEYS


class AgentModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AgentMessage(AgentModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=2000)


class AgentPlan(AgentModel):
    name: str = Field(min_length=1, max_length=120)
    classes: list[Annotated[str, Field(min_length=1, max_length=64)]] = Field(
        min_length=1, max_length=32
    )
    starter_model_key: str
    image_guidance: str = Field(min_length=1, max_length=4000)
    labeling_query: str = Field(min_length=1, max_length=2000)

    @field_validator("starter_model_key")
    @classmethod
    def known_starter(cls, value: str) -> str:
        if value not in STARTER_KEYS:
            raise ValueError("unsupported starter model")
        return value

    def check_meaning(self) -> None:
        names = [name.strip().casefold() for name in self.classes]
        if (not all(names) or len(set(names)) != len(names)
                or not all(v.strip() for v in (self.name, self.image_guidance, self.labeling_query))):
            raise AppError("invalid_plan", "Use nonblank text and unique class names.", 409)


class AgentChatRequest(AgentModel):
    provider: ProviderName
    messages: list[AgentMessage] = Field(min_length=1, max_length=12)
    plan: AgentPlan | None = None


class AgentOutput(AgentModel):
    message: str = Field(min_length=1, max_length=4000)
    plan: AgentPlan | None


class AgentChatResponse(AgentOutput):
    model_name: str
