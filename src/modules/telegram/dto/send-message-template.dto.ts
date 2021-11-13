import { IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class SendMessageTemplateDto {
  @IsInt()
  @Type(() => Number)
  to: number;

  @IsString()
  @Type(() => String)
  template: string;

  @IsOptional()
  @Type(() => Object)
  arguments: Record<string, any>;
}
