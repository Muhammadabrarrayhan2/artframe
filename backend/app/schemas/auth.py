from pydantic import BaseModel, EmailStr, Field
from datetime import datetime


class RegisterIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=2, max_length=100)
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class VerifyOTPIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=10)


class ResendOTPIn(BaseModel):
    email: EmailStr


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class UserOut(BaseModel):
    id: int
    email: EmailStr
    name: str
    is_verified: bool
    role: str
    created_at: datetime

    class Config:
        from_attributes = True


class MessageOut(BaseModel):
    message: str
    detail: str | None = None
