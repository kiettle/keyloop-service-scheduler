import { Transform } from 'class-transformer';
import { IsInt, Max, Min, ValidateBy, ValidationArguments } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const queryInteger = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN;

export class PaginationQueryDto {
  @ApiPropertyOptional({ type: 'integer', default: 1, minimum: 1, maximum: 2147483647 })
  @Transform(queryInteger)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  @ValidateBy({
    name: 'supportedOffset',
    validator: {
      validate: (value: number, args: ValidationArguments) => {
        const query = args.object as PaginationQueryDto;
        return (
          Number.isSafeInteger((value - 1) * query.limit) && (value - 1) * query.limit <= 2147483647
        );
      },
      defaultMessage: () => 'Pagination offset exceeds the supported range.',
    },
  })
  page = 1;

  @ApiPropertyOptional({ type: 'integer', default: 20, minimum: 1, maximum: 100 })
  @Transform(queryInteger)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class PageMetadataDto {
  @ApiProperty({ type: 'integer', minimum: 1, example: 1, description: 'Current page number.' })
  page!: number;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100, example: 20 })
  limit!: number;

  @ApiProperty({ example: false, description: 'Whether another page contains results.' })
  hasNext!: boolean;
}

export function paginationWindow({ page, limit }: PaginationQueryDto) {
  return { skip: (page - 1) * limit, take: limit + 1 };
}

export function paginate<T>(rows: T[], { page, limit }: PaginationQueryDto) {
  return { items: rows.slice(0, limit), page, limit, hasNext: rows.length > limit };
}
