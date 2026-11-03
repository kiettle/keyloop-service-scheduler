import { IsISO8601, IsUUID, Matches } from 'class-validator';

export class AvailabilityQueryDto {
  @IsUUID()
  serviceTypeId!: string;

  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/,
    {
      message:
        'startAt must include seconds and Z or an explicit UTC offset, with at most 3 fractional digits.',
    },
  )
  startAt!: string;
}

export class DealershipParamsDto {
  @IsUUID()
  dealershipId!: string;
}
