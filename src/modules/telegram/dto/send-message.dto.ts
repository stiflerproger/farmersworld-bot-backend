import {IsInt, IsOptional, IsString} from "class-validator";
import {Type} from "class-transformer";

export class SendMessageDto {
  @IsInt()
  @Type(() => Number)
  to: number;

  @IsString()
  @Type(() => String)
  message: string;
}